// Real shape matching between two tiles' faces, at the level of individual
// connected openings (lib/faceBranches.ts's branches) rather than a face's
// whole mask collapsed into one blob — so a placement aligns two openings
// that actually correspond in shape and position ("this reach lines up
// with that reach"), not just "these two faces both have some open area
// somewhere".
//
// Coarse-to-fine, and split existing/candidate prep, because matching.ts
// calls this across every orientation (48) and scale candidate (up to 5)
// for potentially several branches on both sides — a brute-force full
// local search on every single combination was measured at several
// seconds for a modest bank. Two things make it fast:
//  - The existing (already-placed) side's cells don't change across any
//    of that search, so they're projected/bucketed once per
//    (existingBranch, scale) and reused, not rebuilt per trial.
//  - Every (orientation, candidateBranch, scale) combination is first
//    scored cheaply at a single naive offset (centroid difference, no
//    local search) to rank them; only the handful of best-looking combos
//    then get the full local refinement search. A branch pair that's a
//    poor match even at its best naive guess essentially never becomes
//    the winner after a +/-1.5 ft nudge, so this loses negligible quality
//    for roughly a 49x reduction in the expensive part of the search.

import type { ParsedTile } from "@/lib/types";
import { CELL_FT, type FaceBranch } from "@/lib/faceBranches";
import { transformPointFt, type Orientation } from "./transforms";

const SEARCH_RADIUS_CELLS = 7; // +/- a few feet of local refinement around the centroid alignment — wide enough that a real best alignment more than ~1.5 ft from the naive centroid guess still gets found

export interface ProjectedCell {
  world: [number, number, number];
}

/** One branch's cells as world-space (tile-feet) points, after a given
 * instance transform. `positionFt` can be [0,0,0] to get points relative
 * to the instance's own centre instead of absolute world coordinates. */
function projectBranchCells(
  tile: ParsedTile,
  branch: FaceBranch,
  tileFt: [number, number, number],
  o: Orientation,
  scale: number,
  positionFt: [number, number, number],
): ProjectedCell[] {
  const plane = tile.faces.faces[branch.faceName].plane;
  return branch.cells.map(([row, col]) => {
    const u = (col + 0.5) * CELL_FT;
    const v = plane.height_ft - (row + 0.5) * CELL_FT; // row 0 = top = max v, per the plane's own pixel_rule
    const local: [number, number, number] = [
      plane.origin_ft[0] + plane.u_axis[0] * u + plane.v_axis[0] * v,
      plane.origin_ft[1] + plane.u_axis[1] * u + plane.v_axis[1] * v,
      plane.origin_ft[2] + plane.u_axis[2] * u + plane.v_axis[2] * v,
    ];
    return { world: transformPointFt(local, tileFt, o, scale, positionFt) };
  });
}

export interface AlignedBranch {
  /** Best lateral (u,v) position for the candidate instance's own centre,
   * in world tile-feet, on the two axes that aren't the join axis. */
  lateralPositionFt: [number, number];
  /** 0..1 — matched cells over the union of both branches' cells, at the
   * best offset found. */
  score: number;
}

export interface PreparedExistingBranch {
  set: Set<string>;
  size: number;
  meanLat0: number;
  meanLat1: number;
  bucketFt: number;
}

/** Projects and buckets the existing (already-placed) branch's cells once,
 * onto a grid sized to `bucketFt` — reused across every candidate
 * orientation/branch tried against it at this scale. Bucket size is the
 * caller's choice (matching.ts sizes it to the coarser of the two sides'
 * own possibly-scaled cell spacing) since it can't be known until a
 * candidate scale is picked. */
export function prepareExistingBranch(
  existingTile: ParsedTile,
  existingBranch: FaceBranch,
  existingTileFt: [number, number, number],
  existingOrientation: Orientation,
  existingScale: number,
  existingPositionFt: [number, number, number],
  lat0: 0 | 1 | 2,
  lat1: 0 | 1 | 2,
  bucketFt: number,
): PreparedExistingBranch | null {
  const cells = projectBranchCells(existingTile, existingBranch, existingTileFt, existingOrientation, existingScale, existingPositionFt);
  if (cells.length === 0) return null;
  const set = new Set<string>();
  let sumLat0 = 0;
  let sumLat1 = 0;
  for (const c of cells) {
    set.add(bucketKey(bucketFt, c.world[lat0], c.world[lat1]));
    sumLat0 += c.world[lat0];
    sumLat1 += c.world[lat1];
  }
  return { set, size: set.size, meanLat0: sumLat0 / cells.length, meanLat1: sumLat1 / cells.length, bucketFt };
}

export interface ProjectedBranch {
  cells: ProjectedCell[];
  meanLat0: number;
  meanLat1: number;
}

/** Projects one candidate branch (about its own centre) once — reused for
 * both the cheap ranking pass and, if it makes the cut, the refinement
 * pass, so it's never computed twice. */
export function projectCandidateBranch(
  candidateTile: ParsedTile,
  candidateBranch: FaceBranch,
  candidateTileFt: [number, number, number],
  candidateOrientation: Orientation,
  candidateScale: number,
  lat0: 0 | 1 | 2,
  lat1: 0 | 1 | 2,
): ProjectedBranch | null {
  const cells = projectBranchCells(candidateTile, candidateBranch, candidateTileFt, candidateOrientation, candidateScale, [0, 0, 0]);
  if (cells.length === 0) return null;
  let sumLat0 = 0;
  let sumLat1 = 0;
  for (const c of cells) {
    sumLat0 += c.world[lat0];
    sumLat1 += c.world[lat1];
  }
  return { cells, meanLat0: sumLat0 / cells.length, meanLat1: sumLat1 / cells.length };
}

/** The bucketed-cell key for one (lat0,lat1) world point, quantized to
 * `bucketFt` — the shared quantization every IoU comparison in this file
 * (and lib/arrange/depthMatch.ts, which reuses this so a depth check's
 * bucketing can never quietly drift out of sync with a surface check's)
 * keys off. */
export function bucketKey(bucketFt: number, a: number, b: number): string {
  return `${Math.round(a / bucketFt)},${Math.round(b / bucketFt)}`;
}

/** IoU of two already-bucketed cell sets — the same "matched over union"
 * math scoreAtOffset uses below, generalized to two real Sets instead of a
 * prepared set vs. a raw cell list with a per-cell offset. Used where
 * there's no local-search offset to apply (lib/arrange/depthMatch.ts
 * reuses the offset a surface search already found, rather than searching
 * again at depth). */
export function iouOfSets(a: Set<string>, b: Set<string>): number {
  let matched = 0;
  a.forEach((k) => {
    if (b.has(k)) matched++;
  });
  const union = a.size + b.size - matched;
  return union > 0 ? matched / union : 0;
}

function scoreAtOffset(prepared: PreparedExistingBranch, cells: ProjectedCell[], offA: number, offB: number, lat0: 0 | 1 | 2, lat1: 0 | 1 | 2): number {
  const bucketFt = prepared.bucketFt;
  let matched = 0;
  for (const c of cells) {
    const key = bucketKey(bucketFt, c.world[lat0] + offA, c.world[lat1] + offB);
    if (prepared.set.has(key)) matched++;
  }
  const union = prepared.size + cells.length - matched;
  return union > 0 ? matched / union : 0;
}

/** Cheap first-pass ranking score: how well this candidate branch lines up
 * against the prepared existing branch at the naive centroid-difference
 * offset alone, no local search. Used to rank many (orientation, branch)
 * combinations before spending a full search on only the best few. */
export function quickScore(prepared: PreparedExistingBranch, projected: ProjectedBranch, lat0: 0 | 1 | 2, lat1: 0 | 1 | 2): number {
  const guessA = prepared.meanLat0 - projected.meanLat0;
  const guessB = prepared.meanLat1 - projected.meanLat1;
  return scoreAtOffset(prepared, projected.cells, guessA, guessB, lat0, lat1);
}

/** Full local search around the centroid guess — call only on the
 * short-list `quickScore` already picked out. */
export function refineAlignment(prepared: PreparedExistingBranch, projected: ProjectedBranch, lat0: 0 | 1 | 2, lat1: 0 | 1 | 2): AlignedBranch {
  const bucketFt = prepared.bucketFt;
  const guessA = prepared.meanLat0 - projected.meanLat0;
  const guessB = prepared.meanLat1 - projected.meanLat1;
  let best = { a: guessA, b: guessB, score: -1 };
  for (let da = -SEARCH_RADIUS_CELLS; da <= SEARCH_RADIUS_CELLS; da++) {
    for (let db = -SEARCH_RADIUS_CELLS; db <= SEARCH_RADIUS_CELLS; db++) {
      const offA = guessA + da * bucketFt;
      const offB = guessB + db * bucketFt;
      const score = scoreAtOffset(prepared, projected.cells, offA, offB, lat0, lat1);
      if (score > best.score) best = { a: offA, b: offB, score };
    }
  }
  return { lateralPositionFt: [best.a, best.b], score: best.score };
}
