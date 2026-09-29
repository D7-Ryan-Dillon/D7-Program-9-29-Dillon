// The auto-generate algorithm: seeded, greedy, socket-based growth — but
// each socket is now one specific real opening ("branch", see
// lib/faceBranches.ts) on a placed instance's face, not the whole face.
// Starts with one random eligible piece at the origin; repeatedly picks an
// open socket, evaluates EVERY eligible piece's best real-shape fit there
// (orientation, scale, and which of ITS OWN openings lines up — see
// lib/arrange/matching.ts), then chooses among the best few candidates
// (seeded, weighted by fit) rather than trying one random piece and hoping
// it fits. Because every branch gets its own socket, several neighbours can
// join the same face at their own distinct openings — the composition
// articulates instead of only ever growing one flush plane per face.
//
// Fit quality is geometric shape-match first — surface silhouette
// (lib/arrange/shapeMatch.ts) AND, now, whether the two voids stay
// compatible a bit behind the surface too (lib/arrange/depthMatch.ts), not
// just at the joining plane. lib/arrange/flowCompatibility's
// architecturalCompatibility then ranks close candidates by how similarly
// their OWN descriptor scores read (flow descriptors — Continuous/
// Threaded/Graduated/Non-hierarchical — plus the scoring engine's other 8
// spatial-character descriptors), so among genuinely close-fitting options
// the pick also tends to keep a consistent spatial character, not just a
// consistent opening size.
//
// Two things keep the result reading as a deliberate branching structure
// rather than a pile of coincidences:
//  - A placement scoring below MIN_ACCEPTABLE_SCORE is refused outright —
//    the socket is left unfilled rather than forcing whatever's technically
//    touching.
//  - Sockets are picked trunk-first: weighted by the branch's own opening
//    area, so growth tends to establish itself from the biggest, most
//    architecturally significant openings before reaching into smaller
//    ones — closer to how a real branching structure grows than uniformly
//    random socket order.
//
// The mask-based matching above gets a placement CLOSE — but it's matching
// a coarse (6") 2D opening pattern, and these voids are organic, not
// prismatic: two different tiles' openings can look reasonably alike in
// cross-section right at the surface and still diverge a foot behind it.
// Measured directly (by loading the real placed geometry and checking the
// actual minimum distance between pieces, not just trusting the abstract
// match score): that residual was consistently enough to read as "not
// quite touching" for void surfaces, even after fixing two real placement
// bugs (a scale-refinement pass that could silently jump to a different,
// unrelated opening pairing; and a large randomized "overlap" that rigidly
// dragged the matched opening away from where it was aligned — both
// removed). Foam reads fine regardless, because a foam piece is the whole
// 20 ft block — big enough to absorb that residual. A void piece is only
// as big as the opening itself, so it can't.
//
// So the winning placement, specifically, now gets verified against its
// REAL geometry (always the void mesh — the void is what has to actually
// connect, in both foam and void display modes), measured directly rather
// than modelled. This is deliberately only done for the one piece that's
// about to be placed, not for every candidate evaluated, to keep the extra
// geometry loading bounded.
//
// A first version of this correction only closed the gap between each
// side's WHOLE-MESH bounding-box extent along the join axis. That's not
// enough, for two reasons specific to these voids:
//  - `faceBranches.ts` exists because one face commonly has SEVERAL
//    separate openings (chambers). A whole-mesh min/max can belong to a
//    totally different chamber than the one actually being joined here, so
//    "closing the gap" could align the wrong surface.
//  - It only touched the join axis. The two openings' LATERAL alignment
//    comes from the coarse 6" mask correlation (lib/arrange/shapeMatch.ts)
//    matching organic, non-prismatic shapes — close, but with no guarantee
//    the real surfaces overlap laterally even once the join-axis gap is 0.
//
// So the correction instead finds each side's own real FACE SLAB — the
// vertices actually sitting on ITS OWN near-face band, self-referential to
// that mesh alone, not the whole tile's void — and measures the true
// nearest-point-pair distance between the two slabs directly, then moves
// the new piece by that exact 3D vector (not one axis at a time) so the
// nearest real points actually overlap by JOIN_OVERLAP_FT.
//
// A second version of this correction split the fix into an axis-only gap
// close plus a separate lateral-centroid nudge. Measured directly (the same
// way the two bugs above were found): that closed each side's own gap
// check, but independently-corrected axes don't add up to true volumetric
// overlap on a curved, organic surface — CSG union needs the solids to
// actually intersect, not just have each axis "close enough". Checked via
// connected-component flood-fill on the unioned mesh (walking shared
// vertices, not trusting the union call to have succeeded just because it
// didn't throw): 9 pieces produced 12 disconnected fragments, largest
// holding only 26% of the mesh — the same "separates into multiple
// floating objects" the smoothed result was reported to show. The
// nearest-point-pair correction fixes this by construction: whatever
// direction the two real surfaces are actually closest along, that's the
// direction the piece moves, so the guaranteed overlap is real, not just
// per-axis-plausible.
//
// The correction is skipped (leaves the analytical placement alone) if the
// real nearest-point distance is implausibly large to start with
// (MAX_CORRECTION_DIST_FT) — that means the match itself was probably
// wrong, and a confident jump to close it would just paper over a bad pick
// rather than fine-tune a good one.
//
// Stops at `amount` instances or when it runs out of compatible
// sockets/allowed copies.

import * as THREE from "three";
import { FACE_NAMES, type FaceName, type ParsedTile } from "@/lib/types";
import { computeFaceBranches } from "@/lib/faceBranches";
import type { AutoGenerateSettings, BankEntry, Connection, GenerationState, OpenSocket, PlacedInstance } from "./types";
import { bankEligibleTiles, voidContentBBoxFt } from "./types";
import { createRng } from "./rng";
import { bestPlacement, type PlacementCandidate } from "./matching";
import { localFaceFacing } from "./transforms";
import { architecturalCompatibility } from "./flowCompatibility";
import { FEET_PER_METRE, instanceMatrix, loadInstanceGeometry } from "./geometry";

const MIN_ACCEPTABLE_SCORE = 0.12;
// A small, fixed push into real overlap rather than a random 0-1.5 ft one
// — see the file comment above for why a large push broke alignment for
// organic void shapes, and why this needs to be a genuine overlap (not
// just a near-zero gap) for the CSG union to reliably bridge the two
// pieces at all, past any floating-point/BVH tolerance noise in the
// boolean library.
const JOIN_OVERLAP_FT = 0.1;
// Below this, the real geometry is already touching closely enough that
// correcting further isn't worth another geometry load.
const CONTACT_TOLERANCE_FT = 0.05;
const MAX_CONTACT_CORRECTION_PASSES = 3;
// How far from a mesh's own extreme point (along the join axis) a vertex
// can be and still count as "on that face" for realFaceSlab below.
const FACE_SLAB_FT = 1.0;
// A correction bigger than this means the analytical match probably paired
// the wrong openings rather than just landing slightly off — better to
// leave the analytical estimate alone than jump that far to force it.
const MAX_CORRECTION_DIST_FT = 4;

const OPPOSITE: Record<FaceName, FaceName> = {
  "+X": "-X",
  "-X": "+X",
  "+Y": "-Y",
  "-Y": "+Y",
  "+Z": "-Z",
  "-Z": "+Z",
};

const AXIS_OF: Record<FaceName, 0 | 1 | 2> = {
  "+X": 0,
  "-X": 0,
  "+Y": 1,
  "-Y": 1,
  "+Z": 2,
  "-Z": 2,
};

interface EvaluatedCandidate {
  tile: ParsedTile;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  placement: PlacementCandidate;
  /** lib/arrange/flowCompatibility.ts's architecturalCompatibility value
   * for this specific pair — kept alongside finalScore (which already
   * folds it in) so a winning candidate's Connection can record it
   * separately, for a future per-joint inspector. */
  compatibility: number;
  finalScore: number;
}

// 5 evenly-spaced samples across the user's scale range (1 if it's a fixed
// scale) — fit quality, not a pre-picked random scale, decides which one a
// placement actually uses.
function scaleCandidatesFor(settings: AutoGenerateSettings): number[] {
  const { scaleMin, scaleMax } = settings;
  if (scaleMax <= scaleMin) return [scaleMin];
  const n = 5;
  return Array.from({ length: n }, (_, i) => scaleMin + ((scaleMax - scaleMin) * i) / (n - 1));
}

/** Exported so lib/arrange/regenerate.ts can re-open exactly the socket a
 * pruned connection used to occupy without risking the id format ever
 * drifting between the two files. */
export function socketId(instanceId: string, worldDir: FaceName, branchIndex: number): string {
  return `${instanceId}|${worldDir}|${branchIndex}`;
}

/** Every open socket a freshly-placed (or restored) instance offers —
 * id-based (lib/arrange/types.ts's OpenSocket), not the array-index scheme
 * this used before ids existed: an index into `placed[]` goes stale the
 * moment an instance can be removed (lib/arrange/regenerate.ts), an id
 * doesn't. */
function socketsForInstance(inst: PlacedInstance, tile: ParsedTile, excludeWorldDir: FaceName | null): OpenSocket[] {
  const out: OpenSocket[] = [];
  const scale2 = inst.transform.scale * inst.transform.scale;
  for (const worldDir of FACE_NAMES) {
    if (worldDir === excludeWorldDir) continue;
    const localFace = localFaceFacing(worldDir, inst.transform);
    const branches = computeFaceBranches(tile, localFace);
    for (let i = 0; i < branches.length; i++) {
      out.push({ id: socketId(inst.id, worldDir, i), instanceId: inst.id, worldDir, branchIndex: i, branchAreaFt2: branches[i].areaFt2 * scale2 });
    }
  }
  return out;
}

/** Weighted-random pick, by index (so the caller can splice it out of the
 * original array) — used to grow trunk-first: a socket's own opening area
 * is its weight, so bigger, more architecturally significant openings tend
 * to get extended before smaller ones, without making growth order rigidly
 * deterministic (still seeded/random, just biased). */
function weightedPickIndex<T>(rng: () => number, items: T[], weightOf: (item: T) => number): number {
  const total = items.reduce((sum, item) => sum + Math.max(weightOf(item), 1e-6), 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(weightOf(items[i]), 1e-6);
    if (r <= 0) return i;
  }
  return items.length - 1;
}

/** Weighted-random pick (by `scoreOf`) among the top `topK` of `items` — a
 * seeded nudge toward the best-fitting options without always taking the
 * single best (which would make every generation with the same seed and
 * bank feel identical in shape, not just in seed). */
function weightedPickTop<T>(rng: () => number, items: T[], scoreOf: (item: T) => number, topK: number): T {
  const sorted = [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
  const pool = sorted.slice(0, Math.min(topK, sorted.length));
  const total = pool.reduce((sum, item) => sum + Math.max(scoreOf(item), 1e-6), 0);
  let r = rng() * total;
  for (const item of pool) {
    r -= Math.max(scoreOf(item), 1e-6);
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

/** A world-metres point (glTF/render space, from the actually-loaded mesh)
 * back to world tile-feet — inverse of the exporter's own
 * x_ft=F*x_m, y_ft=-F*z_m, z_ft=F*y_m (HANDOFF section 2), so real geometry
 * can be compared directly against `positionFt`-space placement data. */
function metresToTileFt(x: number, y: number, z: number): [number, number, number] {
  return [x * FEET_PER_METRE, -z * FEET_PER_METRE, y * FEET_PER_METRE];
}

/** Every vertex of a real, world-space (tile-ft) geometry, converted once
 * so realFaceSlab below can be called repeatedly (existing side once,
 * candidate side once per correction pass) without re-walking the raw
 * position buffer each time. */
function realVertsFt(geom: THREE.BufferGeometry): [number, number, number][] {
  const pos = geom.attributes.position;
  const out: [number, number, number][] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) out[i] = metresToTileFt(pos.getX(i), pos.getY(i), pos.getZ(i));
  return out;
}

/** The vertices actually sitting on a mesh's OWN outermost surface along
 * `axis` — self-referential to that mesh alone, not the whole tile's void.
 * Restricting to this thin near-face band (not the whole mesh) is what
 * keeps this honest when a void has several separate chambers/branches
 * (lib/faceBranches.ts): a whole-mesh bounding box can't tell those apart,
 * but "vertices actually sitting on my own outermost surface here" can. */
function realFaceSlab(verts: [number, number, number][], axis: 0 | 1 | 2, wantMax: boolean): [number, number, number][] {
  let extreme = wantMax ? -Infinity : Infinity;
  for (const p of verts) {
    if (wantMax ? p[axis] > extreme : p[axis] < extreme) extreme = p[axis];
  }
  return verts.filter((p) => Math.abs(p[axis] - extreme) <= FACE_SLAB_FT);
}

/** The true nearest pair of real points between two vertex sets (exact, not
 * approximated — the slabs this is called on are a thin near-face band, not
 * a whole mesh, so this stays cheap). Used instead of comparing per-axis
 * bounding extents so the correction targets however the two organic
 * surfaces are ACTUALLY closest, not an axis-aligned proxy for it. */
function nearestPair(a: [number, number, number][], b: [number, number, number][]): { dist: number; pa: [number, number, number]; pb: [number, number, number] } {
  let best = Infinity;
  let bestA = a[0];
  let bestB = b[0];
  for (const p of a) {
    for (const q of b) {
      const dx = p[0] - q[0];
      const dy = p[1] - q[1];
      const dz = p[2] - q[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) {
        best = d;
        bestA = p;
        bestB = q;
      }
    }
  }
  return { dist: Math.sqrt(best), pa: bestA, pb: bestB };
}

async function loadRealVoidGeometry(inst: PlacedInstance): Promise<THREE.BufferGeometry | null> {
  const geom = await loadInstanceGeometry(inst, "void");
  if (!geom) return null;
  geom.applyMatrix4(instanceMatrix(inst));
  return geom;
}

/** Nudges `newInstance` until its REAL void geometry actually overlaps
 * `existing`'s (already-loaded, world-space) by JOIN_OVERLAP_FT, instead of
 * trusting the analytical placement to have gotten it exactly right.
 * Moves the piece by the exact 3D vector between the two real surfaces'
 * true nearest points — not one axis at a time — so the guaranteed overlap
 * is real, not just plausible on each axis independently (see file comment
 * for why that distinction turned out to matter). Mutates
 * `newInstance.transform.positionFt` in place. Returns the real measured
 * gap (tile-ft) at whichever point it stopped correcting — negative once
 * genuinely overlapping — so the caller can record it on the Connection
 * this placement becomes; null only if there was no real geometry to
 * measure against at all. */
async function correctForRealContact(
  existingGeom: THREE.BufferGeometry,
  newInstance: PlacedInstance,
  worldDir: FaceName,
): Promise<number | null> {
  const axis = AXIS_OF[worldDir];
  const sign = worldDir.startsWith("+") ? 1 : -1;
  const existingSlab = realFaceSlab(realVertsFt(existingGeom), axis, sign > 0);

  let lastDist: number | null = null;
  for (let pass = 0; pass < MAX_CONTACT_CORRECTION_PASSES; pass++) {
    const candidateGeom = await loadRealVoidGeometry(newInstance);
    if (!candidateGeom) return lastDist;
    const candidateSlab = realFaceSlab(realVertsFt(candidateGeom), axis, sign < 0);

    const { dist, pa, pb } = nearestPair(existingSlab, candidateSlab);
    lastDist = dist;
    if (dist <= CONTACT_TOLERANCE_FT) return dist; // real surfaces already meet — done
    if (dist > MAX_CORRECTION_DIST_FT) return dist; // implausibly far — likely a bad match, leave the analytical estimate alone

    // Move the candidate along the existing->candidate nearest-point vector
    // so that pair ends up overlapping by JOIN_OVERLAP_FT, whatever
    // direction that actually is in 3D.
    const push = (dist + JOIN_OVERLAP_FT) / dist;
    newInstance.transform.positionFt[0] -= (pb[0] - pa[0]) * push;
    newInstance.transform.positionFt[1] -= (pb[1] - pa[1]) * push;
    newInstance.transform.positionFt[2] -= (pb[2] - pa[2]) * push;
  }
  return lastDist;
}

export interface GrowOptions {
  rng?: () => number;
  /** Grow one dominant chain through the biggest available opening first,
   * before falling through to the normal area-weighted-random pick across
   * every open socket — see pickNextSocket below. */
  spineFirst?: boolean;
}

interface SpineState {
  /** The instance the spine is currently extending from — null once the
   * spine has ended (reached its target length, or run out of its own
   * sockets), after which growth is just the normal weighted-random pick
   * for the rest of the run. */
  tipInstanceId: string | null;
  length: number;
  targetLength: number;
}

// Roughly 40% of the requested piece count reads as a real backbone
// without leaving too little of the run for it to branch off of — a
// first-pass heuristic, not derived from anything more precise. Bounded
// so a tiny `amount` doesn't force a spine and a huge one doesn't spine
// out dozens of pieces before ever branching.
const SPINE_FRACTION = 0.4;
const SPINE_MIN_LENGTH = 3;
const SPINE_MAX_LENGTH = 10;

/** Picks which open socket to fill next: the current spine tip's own
 * biggest remaining socket while a spine is active, otherwise the normal
 * area-weighted-random pick across every open socket (also what a spine
 * falls through to once it ends). A failed placement at the tip's biggest
 * socket (splice already removed it from `sockets` by the time the caller
 * finds out) naturally cascades to the tip's next-biggest one on the next
 * call, with no extra bookkeeping needed here — this only decides WHICH
 * socket gets tried next, never whether a candidate for it exists. */
function pickNextSocket(sockets: OpenSocket[], rng: () => number, spine: SpineState | null): number {
  if (spine?.tipInstanceId) {
    let bestIndex = -1;
    let bestArea = -Infinity;
    for (let i = 0; i < sockets.length; i++) {
      if (sockets[i].instanceId === spine.tipInstanceId && sockets[i].branchAreaFt2 > bestArea) {
        bestArea = sockets[i].branchAreaFt2;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) return bestIndex;
    spine.tipInstanceId = null; // the tip has no sockets left -- the spine ends here
  }
  return weightedPickIndex(rng, sockets, (s) => s.branchAreaFt2);
}

/** Builds an empty starting point for growComposition — no instances,
 * nothing open. Exported so lib/arrange/regenerate.ts can build the
 * "everything except what's being regrown" half of a resume without
 * duplicating this shape. */
export function emptyGenerationState(settings: AutoGenerateSettings): GenerationState {
  return { instances: [], connections: [], openSockets: [], usage: new Map(), settings, nextInstanceSeq: 0, nextConnectionSeq: 0 };
}

/** Grows `state` by up to `targetAmount - state.instances.length` more
 * instances, filling only the sockets already open on it (plus whatever
 * new sockets that spawns) — the one shared mechanic behind a fresh
 * autoGenerate() call (starting from a single seed instance), "keep
 * growing this later", and lib/arrange/regenerate.ts's regenerate-marked-
 * joints (which hands this only the freshly-freed sockets, holding
 * everything else back so it's never even visible here). Does not mutate
 * `state` — returns a new GenerationState built from copies, so a caller
 * holding onto the original is unaffected. */
export async function growComposition(
  state: GenerationState,
  bank: BankEntry[],
  targetAmount: number,
  opts?: GrowOptions,
): Promise<GenerationState> {
  const eligible = bankEligibleTiles(bank);
  const rng = opts?.rng ?? createRng(state.settings.seed);
  const scaleCandidates = scaleCandidatesFor(state.settings);

  const instances = [...state.instances];
  const connections = [...state.connections];
  const sockets = [...state.openSockets];
  const usage = new Map(state.usage);
  let nextInstanceSeq = state.nextInstanceSeq;
  let nextConnectionSeq = state.nextConnectionSeq;

  // Seeded from whichever open socket is currently biggest — the seed
  // instance's own biggest socket on a fresh autoGenerate() call, or a
  // just-freed socket's parent on a regenerate (lib/arrange/regenerate.ts)
  // — so both cases pick up the same "start from the most significant
  // opening" rule without needing different logic per caller.
  const spine: SpineState | null = opts?.spineFirst
    ? {
        tipInstanceId: sockets.length > 0 ? sockets.reduce((best, s) => (s.branchAreaFt2 > best.branchAreaFt2 ? s : best), sockets[0]).instanceId : null,
        length: 0,
        targetLength: Math.min(SPINE_MAX_LENGTH, Math.max(SPINE_MIN_LENGTH, Math.round(targetAmount * SPINE_FRACTION))),
      }
    : null;

  const byId = new Map(instances.map((inst) => [inst.id, inst]));
  const tileByGlbUrl = new Map(bank.map((b) => [b.tile.glbUrl, b.tile]));

  const canUse = (glbUrl: string) => (usage.get(glbUrl) ?? 0) < state.settings.maxCopiesPerEntry;
  const use = (glbUrl: string) => usage.set(glbUrl, (usage.get(glbUrl) ?? 0) + 1);

  // Real (not analytical) void geometry for each already-placed instance,
  // loaded once and reused for every child that attaches to it.
  const realGeomCache = new Map<string, THREE.BufferGeometry>();
  async function getRealGeom(inst: PlacedInstance): Promise<THREE.BufferGeometry | null> {
    const cached = realGeomCache.get(inst.id);
    if (cached) return cached;
    const geom = await loadRealVoidGeometry(inst);
    if (geom) realGeomCache.set(inst.id, geom);
    return geom;
  }

  let guard = 0;
  const guardLimit = Math.max((targetAmount - instances.length) * 25, 150);
  while (instances.length < targetAmount && sockets.length > 0 && guard < guardLimit) {
    guard++;
    const socketIndex = pickNextSocket(sockets, rng, spine);
    const socket = sockets[socketIndex];
    sockets.splice(socketIndex, 1);

    const existing = byId.get(socket.instanceId);
    if (!existing) continue; // socket's own instance was pruned out from under it — shouldn't happen, but never crash a generation over it
    const existingTile = tileByGlbUrl.get(existing.glbUrl);
    if (!existingTile) continue;

    const choices = eligible.filter((t) => canUse(t.glbUrl));
    if (choices.length === 0) continue;

    const evaluated: EvaluatedCandidate[] = [];
    for (const candidateTile of choices) {
      const bbox = voidContentBBoxFt(candidateTile);
      const placement = bestPlacement(
        existing,
        existingTile,
        socket.worldDir,
        candidateTile,
        candidateTile.tile.tile_ft,
        bbox.min,
        bbox.max,
        scaleCandidates,
        JOIN_OVERLAP_FT,
        socket.branchIndex,
      );
      if (!placement || placement.score < MIN_ACCEPTABLE_SCORE) continue;
      const compatibility = architecturalCompatibility(existingTile, candidateTile);
      const finalScore = placement.score * (0.7 + 0.3 * compatibility);
      evaluated.push({ tile: candidateTile, bbox, placement, compatibility, finalScore });
    }
    if (evaluated.length === 0) continue; // nothing lined up well enough — leave this socket unfilled rather than force a bad join

    const picked = weightedPickTop(rng, evaluated, (c) => c.finalScore, 3);

    nextInstanceSeq++;
    const newInstance: PlacedInstance = {
      id: `inst-${nextInstanceSeq}`,
      glbUrl: picked.tile.glbUrl,
      tileName: picked.tile.tile.name,
      tileFt: picked.tile.tile.tile_ft,
      contentMinFt: picked.bbox.min,
      contentMaxFt: picked.bbox.max,
      transform: {
        positionFt: picked.placement.positionFt,
        rotXSteps: picked.placement.orientation.rotXSteps,
        rotYSteps: picked.placement.orientation.rotYSteps,
        rotZSteps: picked.placement.orientation.rotZSteps,
        mirrorX: picked.placement.orientation.mirrorX,
        mirrorY: picked.placement.orientation.mirrorY,
        scale: picked.placement.scale,
      },
    };

    const existingRealGeom = await getRealGeom(existing);
    const realGapFt = existingRealGeom ? await correctForRealContact(existingRealGeom, newInstance, socket.worldDir) : null;

    instances.push(newInstance);
    byId.set(newInstance.id, newInstance);
    use(picked.tile.glbUrl);

    // The spine only advances on an actual placement — a failed attempt at
    // the tip's biggest socket just falls through to its next-biggest one
    // on the next pickNextSocket call, no bookkeeping needed here for that
    // case.
    if (spine?.tipInstanceId === existing.id) {
      spine.length++;
      spine.tipInstanceId = spine.length >= spine.targetLength ? null : newInstance.id;
    }

    nextConnectionSeq++;
    const childWorldDir = OPPOSITE[socket.worldDir]; // the new instance's own side facing back at `existing`
    connections.push({
      id: `conn-${nextConnectionSeq}`,
      parentInstanceId: existing.id,
      childInstanceId: newInstance.id,
      parentWorldDir: socket.worldDir,
      parentBranchIndex: socket.branchIndex,
      childWorldDir,
      childBranchIndex: picked.placement.candidateBranchIndex,
      matchScore: picked.placement.score,
      compatibilityScore: picked.compatibility,
      realGapFt,
    });

    sockets.push(...socketsForInstance(newInstance, picked.tile, childWorldDir));
  }

  return { instances, connections, openSockets: sockets, usage, settings: state.settings, nextInstanceSeq, nextConnectionSeq };
}

export async function autoGenerate(bank: BankEntry[], settings: AutoGenerateSettings): Promise<GenerationState> {
  const empty = emptyGenerationState(settings);
  const eligible = bankEligibleTiles(bank);
  if (eligible.length === 0 || settings.amount <= 0) return empty;

  const rng = createRng(settings.seed);
  const scaleCandidates = scaleCandidatesFor(settings);
  const randomScale = () => scaleCandidates[Math.floor(rng() * scaleCandidates.length)];

  const firstChoices = eligible.filter((t) => (empty.usage.get(t.glbUrl) ?? 0) < settings.maxCopiesPerEntry);
  if (firstChoices.length === 0) return empty;
  const firstTile = firstChoices[Math.floor(rng() * firstChoices.length)];
  const firstBBox = voidContentBBoxFt(firstTile);
  const firstInstance: PlacedInstance = {
    id: "inst-0",
    glbUrl: firstTile.glbUrl,
    tileName: firstTile.tile.name,
    tileFt: firstTile.tile.tile_ft,
    contentMinFt: firstBBox.min,
    contentMaxFt: firstBBox.max,
    transform: {
      positionFt: [0, 0, 0],
      rotXSteps: 0,
      rotYSteps: 0,
      rotZSteps: 0,
      mirrorX: false,
      mirrorY: false,
      scale: randomScale(),
    },
  };
  const seeded: GenerationState = {
    ...empty,
    instances: [firstInstance],
    usage: new Map([[firstTile.glbUrl, 1]]),
    openSockets: socketsForInstance(firstInstance, firstTile, null),
    nextInstanceSeq: 0,
  };

  return growComposition(seeded, bank, settings.amount, { rng, spineFirst: settings.spineFirst });
}
