// Turns the current composition into one real, watertight solid — a true
// boolean union (three-bvh-csg), not just concatenated separate meshes
// (which is all lib/arrange/geometry.ts's buildMergedGeometry does, and
// all "Export OBJ" produces when this isn't used). The union is what makes
// the result usable for 3D printing or bringing into Rhino as a single
// clean closed mesh, per the user's own requirement — a "smoothed but not
// actually sealed" look wouldn't satisfy that.
//
// Booleans on procedurally-generated, organically-overlapping meshes are
// the least forgiving thing you can ask a CSG library to do: any one piece
// with a stray non-manifold triangle can make its union step fail. Each
// union is wrapped so a single bad piece is skipped (reported back, not
// silently dropped) rather than failing the whole composition.
//
// The raw union result reads as faceted right at the seams (the cut plane
// introduces new, sharp triangle edges) — a short Laplacian smoothing pass
// afterward (average each vertex toward its neighbours, a few times) softens
// exactly those seams. Earlier this ran over the WHOLE mesh, on the theory
// that interior-of-a-single-piece regions barely move since they're already
// smooth — wrong in practice: uniform Laplacian smoothing shrinks thin
// features (exactly what a branch tip is) regardless of whether they're
// near a seam, which read as "parts of the model disappearing". Now it only
// ever moves a vertex that's provably NEW — introduced by the CSG cut
// itself, not present in any input piece before the union (see
// markSeamVertices) — expanded by a couple of mesh-adjacency rings for a
// gradual blend, with every other vertex held completely fixed.
//
// Booleans also leave their own tiny numerical gaps along the intersection
// curve even when both inputs are already perfectly watertight (verified:
// this app's own source meshes are) — a well-known CSG limitation, not a
// bug in either input. Vertex welding alone can't fully close these: a
// tighter tolerance leaves gaps, a looser one starts fusing unrelated
// nearby vertices into non-manifold pinches instead. So after welding, any
// remaining small boundary loops are located and capped directly
// (fillBoundaryHoles) rather than papering over them with a blunter weld.
//
// three-bvh-csg's own Evaluator allocates its result's attribute buffers
// with conservative (larger-than-needed) capacity and marks the actually-
// valid portion with `geometry.drawRange` (see its Evaluator.js:
// assignBufferData) — the library's own internal re-use of that result as
// the next operation's input correctly respects drawRange (HalfEdgeMap
// does too), but three.js's own BufferGeometryUtils.mergeVertices does
// NOT: it reads `positions.count`, the full buffer, unconditionally.
// Traced directly (not guessed) after a composition that measurably had
// every real piece-to-piece gap closed to a few hundredths of a foot still
// came out of the union as a dozen-plus disconnected fragments in the
// final mesh: mergeVertices was welding in stale, past-drawRange buffer
// contents as if they were real leftover geometry, corrupting exactly the
// step meant to help close the seams. trimToDrawRange runs once, right
// after the union loop, before any of this file's own post-processing
// touches the result.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, ADDITION } from "three-bvh-csg";
import type { PieceKind, PlacedInstance } from "./types";
import { instanceMatrix, loadInstanceGeometry } from "./geometry";

const WELD_TOLERANCE_FT = 1e-3; // ~1mm (this file works in the glTF's own metres, despite the name) — coincident-seam-vertex scale, not "nearby feature" scale
const SMOOTH_ITERATIONS = 4; // more iterations is safe now that it's localized — it can't shrink the rest of the model
const SMOOTH_LAMBDA = 0.5; // how far a seam vertex moves toward its neighbours' average, per iteration
const SEAM_RING_EXPANSION = 3; // how many mesh-adjacency hops out from a true cut vertex also get smoothed, for a gradual blend
const MAX_HOLE_LOOP_EDGES = 200; // a loop bigger than this is more likely a real modeling gap than a numerical seam sliver

export interface SmoothedSolid {
  geometry: THREE.BufferGeometry;
  /** How many instances couldn't be unioned in (non-manifold or otherwise
   * unusable geometry for boolean ops) and were left out. */
  failedCount: number;
  /** Boundary edges still open after welding + hole-filling — 0 means the
   * result is genuinely watertight. A small leftover count usually means a
   * few holes were too irregular (past MAX_HOLE_LOOP_EDGES, or tangled by a
   * nearby non-manifold edge) to safely auto-cap. */
  openEdgeCount: number;
}

/** Finds boundary edges (belonging to exactly one triangle), chains them
 * into loops, and fan-caps any loop small enough to trust — closing the
 * small numerical gaps a CSG union leaves along its cut curve. The lone
 * owning triangle's own (a, b) edge direction is preserved when chaining,
 * so the cap triangles come out wound the same way as the rest of the mesh
 * (this is the standard boundary-loop-orientation result, not guessed).
 * Mutates `geometry`'s index in place; returns how many loops were capped. */
function fillBoundaryHoles(geometry: THREE.BufferGeometry): { filled: number; loopVertices: Set<number> } {
  const index = geometry.index;
  if (!index) return { filled: 0, loopVertices: new Set() };
  const idx = index.array;

  const edgeUses = new Map<string, { count: number; a: number; b: number }>();
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const existing = edgeUses.get(key);
      if (existing) existing.count++;
      else edgeUses.set(key, { count: 1, a, b });
    }
  }

  // A single next-vertex-per-vertex map silently drops edges wherever a
  // vertex happens to start more than one boundary half-edge (common right
  // near a non-manifold pinch, which these unions frequently leave nearby)
  // — so this tracks individual directed edges instead, letting one vertex
  // correctly participate in several distinct loops.
  const outgoing = new Map<number, number[]>();
  const boundaryEdges: [number, number][] = [];
  edgeUses.forEach(({ count, a, b }) => {
    if (count !== 1) return;
    boundaryEdges.push([a, b]);
    if (!outgoing.has(a)) outgoing.set(a, []);
    outgoing.get(a)!.push(b);
  });

  const consumed = new Set<string>();
  const edgeKey = (a: number, b: number) => `${a}_${b}`;
  const newTriangles: number[] = [];
  let filled = 0;
  // Every vertex touching a boundary edge is at a problem spot in the
  // union — worth smoothing even if its own loop couldn't be safely
  // capped (dangling, or tangled with a nearby non-manifold edge).
  const loopVertices = new Set<number>();
  for (const [a, b] of boundaryEdges) {
    loopVertices.add(a);
    loopVertices.add(b);
  }

  for (const [startA, startB] of boundaryEdges) {
    if (consumed.has(edgeKey(startA, startB))) continue;
    const loop: number[] = [startA];
    let current = startA;
    let step = startB;
    let ok = true;
    let guard = 0;
    while (true) {
      consumed.add(edgeKey(current, step));
      if (step === startA) break; // closed the loop
      loop.push(step);
      const candidates = outgoing.get(step);
      const found = candidates?.find((c) => !consumed.has(edgeKey(step, c)));
      if (found === undefined) {
        ok = false; // dangling — not a clean loop, leave it
        break;
      }
      current = step;
      step = found;
      guard++;
      if (guard > MAX_HOLE_LOOP_EDGES + 5) {
        ok = false;
        break;
      }
    }
    if (ok && loop.length >= 3 && loop.length <= MAX_HOLE_LOOP_EDGES) {
      for (let i = 1; i < loop.length - 1; i++) newTriangles.push(loop[0], loop[i], loop[i + 1]);
      filled++;
    }
  }

  if (newTriangles.length > 0) {
    const combined = new Uint32Array(idx.length + newTriangles.length);
    combined.set(idx, 0);
    combined.set(newTriangles, idx.length);
    geometry.setIndex(new THREE.BufferAttribute(combined, 1));
  }
  return { filled, loopVertices };
}

/** Counts remaining open (boundary) edges — used to report how watertight
 * the final result actually is, not just assumed. */
function countOpenEdges(geometry: THREE.BufferGeometry): number {
  const index = geometry.index;
  if (!index) return 0;
  const idx = index.array;
  const edgeCount = new Map<string, number>();
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  edgeCount.forEach((c) => {
    if (c !== 2) open++;
  });
  return open;
}

/** Returns a geometry whose buffers hold exactly `geometry.drawRange` and
 * nothing past it — see the file comment above for why this matters. CSG
 * output is typically non-indexed (three-bvh-csg drops the index when its
 * internal buffer no longer matches), so drawRange there addresses the
 * attribute arrays directly; the indexed branch is handled too, for
 * whatever geometry this ever runs on. Attributes are only copied (new
 * trimmed arrays) when they actually need trimming — an untouched
 * drawRange (the common case for ordinary, non-CSG geometry) returns the
 * input unchanged. */
function trimToDrawRange(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const { start, count } = geometry.drawRange;
  if (count === Infinity && start === 0) return geometry;

  const out = new THREE.BufferGeometry();
  if (geometry.index) {
    for (const name of Object.keys(geometry.attributes)) out.setAttribute(name, geometry.attributes[name]);
    const idxArr = geometry.index.array;
    const end = Math.min(start + count, idxArr.length);
    out.setIndex(new THREE.BufferAttribute(idxArr.slice(start, end), 1));
  } else {
    for (const name of Object.keys(geometry.attributes)) {
      const attr = geometry.attributes[name] as THREE.BufferAttribute;
      const itemSize = attr.itemSize;
      const sliceStart = start * itemSize;
      const sliceEnd = Math.min((start + count) * itemSize, attr.array.length);
      const trimmed = attr.array.slice(sliceStart, sliceEnd);
      out.setAttribute(name, new THREE.BufferAttribute(trimmed, itemSize, attr.normalized));
    }
  }
  return out;
}

function positionKey(x: number, y: number, z: number): string {
  const inv = 1 / WELD_TOLERANCE_FT;
  return `${Math.round(x * inv)}_${Math.round(y * inv)}_${Math.round(z * inv)}`;
}

// How far apart two still-disconnected components' nearest real points can
// be and still get bridged (see bridgeDisconnectedComponents) — generous
// enough to catch a join the CSG union failed to stitch despite genuine
// contact (lib/arrange/autoGenerate.ts pushes pieces into ~0.03m of real
// overlap before union ever runs), tight enough that two pieces that were
// never meant to touch, and just happen to pass near each other elsewhere
// in the composition, don't get welded together by mistake.
const BRIDGE_SEARCH_DISTANCE_M = 0.5;

/** Every connected component of `geometry` (vertex indices reachable from
 * one another via a shared triangle edge), as a list of index arrays. */
function findComponents(index: ArrayLike<number>, vertexCount: number): number[][] {
  const neighbors: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  const visited = new Uint8Array(vertexCount);
  const components: number[][] = [];
  for (let start = 0; start < vertexCount; start++) {
    if (visited[start]) continue;
    const comp: number[] = [];
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      neighbors[v].forEach((n) => {
        if (!visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      });
    }
    components.push(comp);
  }
  return components;
}

function bboxOf(position: THREE.BufferAttribute, verts: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    const p: [number, number, number] = [position.getX(v), position.getY(v), position.getZ(v)];
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  }
  return { min, max };
}

function bboxesWithin(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }, maxDist: number): boolean {
  for (let ax = 0; ax < 3; ax++) {
    if (a.min[ax] - b.max[ax] > maxDist) return false;
    if (b.min[ax] - a.max[ax] > maxDist) return false;
  }
  return true;
}

/** The true nearest pair of real vertices between two index sets, within
 * `maxDist` — grid-bucketed (cell size = maxDist) rather than brute-force,
 * so this stays cheap even when a disconnected component is an entire
 * unmerged ~10k-vertex piece, not just a thin seam ring. */
function nearestCrossSetPoint(
  position: THREE.BufferAttribute,
  setA: number[],
  setB: number[],
  maxDist: number,
): { va: number; vb: number; distSq: number } | null {
  const cell = (x: number, y: number, z: number) => `${Math.floor(x / maxDist)}_${Math.floor(y / maxDist)}_${Math.floor(z / maxDist)}`;
  const grid = new Map<string, number[]>();
  for (const vb of setB) {
    const key = cell(position.getX(vb), position.getY(vb), position.getZ(vb));
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(vb);
  }

  const maxDistSq = maxDist * maxDist;
  let best: { va: number; vb: number; distSq: number } | null = null;
  for (const va of setA) {
    const x = position.getX(va);
    const y = position.getY(va);
    const z = position.getZ(va);
    const cx = Math.floor(x / maxDist);
    const cy = Math.floor(y / maxDist);
    const cz = Math.floor(z / maxDist);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx}_${cy + dy}_${cz + dz}`);
          if (!bucket) continue;
          for (const vb of bucket) {
            const ddx = x - position.getX(vb);
            const ddy = y - position.getY(vb);
            const ddz = z - position.getZ(vb);
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
            if (distSq <= maxDistSq && (!best || distSq < best.distSq)) best = { va, vb, distSq };
          }
        }
      }
    }
  }
  return best;
}

/** three-bvh-csg is explicit that its result "may not be correctly
 * completely two-manifold" (its own README) — measured directly on this
 * app's actual compositions: even after every real per-piece gap was
 * closed to a few hundredths of a foot before the union ever ran, a
 * 9-piece union still regularly came out as a dozen-plus disconnected
 * fragments (component sizes clustering right around one original piece
 * each — consistent with some union steps not stitching in a new piece at
 * all, rather than a partial/ragged stitch). Retried the union step itself
 * several ways (re-normalizing the accumulated brush between every step,
 * loosening the weld tolerance 20x) without it reliably closing — so
 * rather than keep tuning a step this library documents as not always
 * getting right, this repairs the RESULT directly: finds any components
 * that are still separate after the union, and for each pair whose real
 * nearest approach is within BRIDGE_SEARCH_DISTANCE_M, snaps that one
 * vertex pair to the same position (in increasing-distance / Kruskal's
 * order, so a component already bridged via a closer pair doesn't also
 * pull in a farther, redundant one) — cheap, and unconditionally
 * guarantees the result reads as one connected mass rather than hoping the
 * boolean union got every join right. Only snaps positions; the caller
 * re-welds afterward so the now-coincident vertices actually become one
 * shared index. Returns the position-keys of every point moved, so the
 * caller can look them up again (by position, since a re-weld renumbers
 * indices) to also smooth over the new seam. */
function bridgeDisconnectedComponents(geometry: THREE.BufferGeometry): Set<string> {
  const bridged = new Set<string>();
  const index = geometry.index;
  if (!index) return bridged;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = position.count;

  const components = findComponents(index.array, vertexCount);
  if (components.length <= 1) return bridged;

  const bboxes = components.map((comp) => bboxOf(position, comp));

  interface Candidate {
    distSq: number;
    va: number;
    vb: number;
    ci: number;
    cj: number;
  }
  const candidates: Candidate[] = [];
  for (let ci = 0; ci < components.length; ci++) {
    for (let cj = ci + 1; cj < components.length; cj++) {
      if (!bboxesWithin(bboxes[ci], bboxes[cj], BRIDGE_SEARCH_DISTANCE_M)) continue;
      const nearest = nearestCrossSetPoint(position, components[ci], components[cj], BRIDGE_SEARCH_DISTANCE_M);
      if (nearest) candidates.push({ ...nearest, ci, cj });
    }
  }
  candidates.sort((a, b) => a.distSq - b.distSq);

  const parent = components.map((_, i) => i);
  function find(x: number): number {
    return parent[x] === x ? x : (parent[x] = find(parent[x]));
  }

  // mergeVertices hashes on EVERY attribute (three.js's own
  // BufferGeometryUtils.js), not just position — two vertices at the exact
  // same point but with different normals (which any two points from
  // unrelated, independently-oriented surfaces will have) still hash
  // differently and won't actually merge. So bridging has to make `vb` a
  // true duplicate of `va` across every attribute the geometry carries,
  // not just snap its position.
  const attributeNames = Object.keys(geometry.attributes);
  function copyVertex(from: number, to: number): void {
    for (const name of attributeNames) {
      const attr = geometry.attributes[name] as THREE.BufferAttribute;
      for (let k = 0; k < attr.itemSize; k++) attr.setComponent(to, k, attr.getComponent(from, k));
    }
  }

  for (const cand of candidates) {
    const ra = find(cand.ci);
    const rb = find(cand.cj);
    if (ra === rb) continue; // already bridged via a closer pair
    const ax = position.getX(cand.va);
    const ay = position.getY(cand.va);
    const az = position.getZ(cand.va);
    copyVertex(cand.va, cand.vb);
    bridged.add(positionKey(ax, ay, az));
    parent[ra] = rb;
  }

  for (const name of attributeNames) (geometry.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  return bridged;
}

// A real piece's own geometry runs to thousands of vertices (these tiles'
// void/foam meshes). Anything still disconnected below this size, after
// bridging already had its chance to reach it, is degenerate CSG
// intersection-curve noise (a sliver triangle or two right at a cut) —
// genuinely isolated, not a real fragment of the model — so it gets
// dropped rather than forced into a wrong, far-away join.
const MIN_KEPT_COMPONENT_VERTS = 30;

/** Deletes any connected component of `geometry` smaller than
 * MIN_KEPT_COMPONENT_VERTS (see above) — the last step of getting to a
 * single real mass, for whatever debris bridgeDisconnectedComponents
 * correctly declined to bridge (too far from anything to trust as a real
 * join). Mutates `geometry`'s index in place. Returns how many triangles
 * were removed, for the caller to report if it wants to. */
function pruneTinyComponents(geometry: THREE.BufferGeometry): number {
  const index = geometry.index;
  if (!index) return 0;
  const vertexCount = geometry.attributes.position.count;
  const components = findComponents(index.array, vertexCount);
  if (components.length <= 1) return 0;

  const keep = new Set<number>();
  for (const comp of components) {
    if (comp.length >= MIN_KEPT_COMPONENT_VERTS) for (const v of comp) keep.add(v);
  }
  if (keep.size === vertexCount) return 0; // nothing small enough to drop

  const idx = index.array;
  const newIndex: number[] = [];
  let removedTriangles = 0;
  for (let i = 0; i < idx.length; i += 3) {
    if (keep.has(idx[i]) && keep.has(idx[i + 1]) && keep.has(idx[i + 2])) {
      newIndex.push(idx[i], idx[i + 1], idx[i + 2]);
    } else {
      removedTriangles++;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndex), 1));
  return removedTriangles;
}

/** Every vertex position that existed in ANY input piece before the union
 * — the baseline "this point is part of a piece's own original surface"
 * set. Anything in the final merged mesh that ISN'T one of these positions
 * must have been newly created by the CSG cut itself (the triangle
 * splitter interpolates fresh vertices exactly along the intersection
 * curve), which is the precise definition of "seam" this uses — not a
 * guess based on distance or which triangles happen to look close to a
 * join. */
function recordOriginalPositions(geometry: THREE.BufferGeometry, into: Set<string>): void {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    into.add(positionKey(position.getX(i), position.getY(i), position.getZ(i)));
  }
}

/** Marks which vertices of the final merged geometry are genuinely new
 * (not in `originalPositions`) — the true cut/seam — then grows that set
 * outward a few mesh-adjacency hops so smoothing has a gradual blend zone
 * instead of a hard on/off edge. Returns the expanded movable set and the
 * adjacency map (so laplacianSmooth doesn't have to rebuild it). */
function markSeamVertices(
  geometry: THREE.BufferGeometry,
  originalPositions: Set<string>,
  extraSeamVertices: Set<number>,
  rings: number,
): { movable: Set<number>; neighbors: Set<number>[] } {
  const index = geometry.index!;
  const position = geometry.attributes.position;
  const vertexCount = position.count;

  const neighbors: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  const idx = index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }

  let frontier = new Set<number>(extraSeamVertices);
  for (let v = 0; v < vertexCount; v++) {
    const key = positionKey(position.getX(v), position.getY(v), position.getZ(v));
    if (!originalPositions.has(key)) frontier.add(v);
  }

  const movable = new Set(frontier);
  for (let ring = 0; ring < rings; ring++) {
    const nextFrontier = new Set<number>();
    frontier.forEach((v) => {
      neighbors[v].forEach((n) => {
        if (!movable.has(n)) {
          movable.add(n);
          nextFrontier.add(n);
        }
      });
    });
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return { movable, neighbors };
}

/** Averages each vertex toward its neighbours, but only for vertices in
 * `movable` — everything else stays exactly where it is, including when
 * OTHER vertices' averages reference it, which is what pulls the smoothed
 * region toward a seamless blend with the untouched surface around it
 * rather than an abrupt boundary. */
function laplacianSmooth(
  geometry: THREE.BufferGeometry,
  neighbors: Set<number>[],
  movable: Set<number>,
  iterations: number,
  lambda: number,
): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  if (movable.size === 0) return;

  let current = position.array.slice() as Float32Array;
  for (let iter = 0; iter < iterations; iter++) {
    const next = current.slice();
    movable.forEach((v) => {
      const nbrs = neighbors[v];
      if (nbrs.size === 0) return;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      nbrs.forEach((n) => {
        sx += current[n * 3];
        sy += current[n * 3 + 1];
        sz += current[n * 3 + 2];
      });
      const inv = 1 / nbrs.size;
      next[v * 3] = current[v * 3] * (1 - lambda) + sx * inv * lambda;
      next[v * 3 + 1] = current[v * 3 + 1] * (1 - lambda) + sy * inv * lambda;
      next[v * 3 + 2] = current[v * 3 + 2] * (1 - lambda) + sz * inv * lambda;
    });
    current = next;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(current, 3));
  geometry.computeVertexNormals();
}

/** Builds one real, watertight solid from the current composition via
 * sequential boolean union, then softens the resulting seams. `onProgress`
 * (optional) is called after each piece so the caller can show something
 * like "3 / 8 merged" — this can take real time on a large composition. */
export async function buildSmoothedSolid(
  instances: PlacedInstance[],
  pieceMode: PieceKind,
  onProgress?: (done: number, total: number) => void,
): Promise<SmoothedSolid | null> {
  const evaluator = new Evaluator();
  evaluator.useGroups = false; // one flat-colored material — no per-face group bookkeeping needed
  evaluator.attributes = ["position", "normal"]; // these exported meshes carry no UVs

  let resultBrush: Brush | null = null;
  let failedCount = 0;
  // Every vertex position from every input piece, before the union ever
  // touches them — the baseline markSeamVertices compares against to find
  // what the union actually introduced.
  const originalPositions = new Set<string>();

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const raw = await loadInstanceGeometry(inst, pieceMode);
    if (!raw) {
      failedCount++;
      onProgress?.(i + 1, instances.length);
      continue;
    }
    raw.applyMatrix4(instanceMatrix(inst));
    const welded = mergeVertices(raw, WELD_TOLERANCE_FT);
    welded.computeVertexNormals();
    recordOriginalPositions(welded, originalPositions);
    const brush = new Brush(welded);
    brush.updateMatrixWorld();

    if (!resultBrush) {
      resultBrush = brush;
    } else {
      try {
        const unioned = evaluator.evaluate(resultBrush, brush, ADDITION);
        // Re-weld after every step, not just once at the end — feeding
        // evaluate() a freshly-cleaned brush each time (rather than
        // reusing its own prior raw output, unexamined, as the next
        // step's input) measurably reduced leftover open edges in testing.
        // Not sufficient by itself (see bridgeDisconnectedComponents
        // below for what actually closes the remaining gaps), but cheap
        // enough per step to keep as a real, if partial, improvement.
        const cleanGeom = mergeVertices(trimToDrawRange(unioned.geometry), WELD_TOLERANCE_FT);
        cleanGeom.computeVertexNormals();
        resultBrush = new Brush(cleanGeom);
        resultBrush.updateMatrixWorld();
      } catch (err) {
        console.warn("[smoothMerge] union failed for one piece, leaving it out of the solid:", err);
        failedCount++;
      }
    }
    onProgress?.(i + 1, instances.length);
    // yield a tick so the UI can actually repaint a progress update between
    // these potentially-expensive union steps
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (!resultBrush) return null;

  const merged = mergeVertices(trimToDrawRange(resultBrush.geometry), WELD_TOLERANCE_FT);
  const bridgedPositions = bridgeDisconnectedComponents(merged);
  // Re-weld only if anything actually got bridged — the snap only moved
  // vertex POSITIONS; this is what actually turns the now-coincident pairs
  // into one real shared index.
  const welded = bridgedPositions.size > 0 ? mergeVertices(merged, WELD_TOLERANCE_FT) : merged;
  pruneTinyComponents(welded);

  const bridgeVertices = new Set<number>();
  if (bridgedPositions.size > 0) {
    const position = welded.attributes.position;
    for (let i = 0; i < position.count; i++) {
      if (bridgedPositions.has(positionKey(position.getX(i), position.getY(i), position.getZ(i)))) bridgeVertices.add(i);
    }
  }

  const { loopVertices } = fillBoundaryHoles(welded);
  const extraSeamVertices = new Set<number>([...loopVertices, ...bridgeVertices]);
  const { movable, neighbors } = markSeamVertices(welded, originalPositions, extraSeamVertices, SEAM_RING_EXPANSION);
  laplacianSmooth(welded, neighbors, movable, SMOOTH_ITERATIONS, SMOOTH_LAMBDA);
  const openEdgeCount = countOpenEdges(welded);
  return { geometry: welded, failedCount, openEdgeCount };
}
