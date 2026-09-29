// Finds the best way to attach a candidate tile's piece onto an
// already-placed instance's exposed face: searches every orientation
// (lib/arrange/transforms.ts's SEARCH_ORIENTATIONS), every scale candidate
// offered, and every real opening ("branch", lib/faceBranches.ts) on both
// sides, using lib/arrange/shapeMatch.ts's real mask-correlation to score
// how well a specific existing opening and a specific candidate opening
// actually line up — not "these two faces have similar total open area",
// and not locked to a rigid centre-to-centre grid.
//
// The join-axis (depth) position comes from each side's own CONTENT extent
// (a void's real bounding box, not the full 20 ft tile block it sits in),
// so a small void doesn't leave a gap sized for the whole tile.

import type { FaceName, ParsedTile } from "@/lib/types";
import { CELL_FT, computeFaceBranches, type FaceBranch } from "@/lib/faceBranches";
import type { PlacedInstance } from "./types";
import { SEARCH_ORIENTATIONS, localFaceFacing, transformedContentExtent, type Orientation } from "./transforms";
import { prepareExistingBranch, projectCandidateBranch, quickScore, refineAlignment, type ProjectedBranch } from "./shapeMatch";
import { depthCompatibility } from "./depthMatch";

// How many of the cheaply-ranked (orientation, candidate branch) combos get
// the expensive full local-search refinement, per (existing branch, scale).
// A poor match at its naive centroid guess essentially never becomes the
// winner after only a +/- few cell nudge, so this doesn't need to be huge —
// but wider than a first pass, since the whole point of a real search is
// not to silently throw away a combo the cheap ranking underrated.
const REFINE_TOP_K = 16;

const AXIS_OF: Record<FaceName, 0 | 1 | 2> = {
  "+X": 0,
  "-X": 0,
  "+Y": 1,
  "-Y": 1,
  "+Z": 2,
  "-Z": 2,
};

const OPPOSITE: Record<FaceName, FaceName> = {
  "+X": "-X",
  "-X": "+X",
  "+Y": "-Y",
  "-Y": "+Y",
  "+Z": "-Z",
  "-Z": "+Z",
};

export interface PlacementCandidate {
  orientation: Orientation;
  positionFt: [number, number, number];
  scale: number;
  /** 0..1 — min(surfaceScore, depthScore): the combined shape-match
   * quality this placement actually won on. */
  score: number;
  /** 0..1 — the two openings' silhouette IoU right at the joining plane
   * (lib/arrange/shapeMatch.ts). */
  surfaceScore: number;
  /** 0..1, or null if there was no section data to check (see
   * lib/arrange/depthMatch.ts) — whether the two voids stay compatible a
   * bit behind the surface, not just at it. */
  depthScore: number | null;
  /** Which of the CANDIDATE tile's own branches (at the winning
   * orientation) this placement joins through — the existing side's branch
   * is already known to the caller (autoGenerate passes it in explicitly
   * per-socket), but the candidate's own winning branch isn't observable
   * from outside this search, and lib/arrange/types.ts's Connection needs
   * it. */
  candidateBranchIndex: number;
}

/** `existingWorldDir`: the world direction, from `existing`, that the new
 * piece is being attached in (e.g. "+X" = the new piece goes on existing's
 * +X side). `existingBranchIndex` restricts the search to one specific
 * opening on that face (auto-generate's per-socket calls, where each
 * distinct opening gets its own independent connection); leave it out to
 * try every opening on that face and return the single best across all of
 * them (manual "snap to nearest", which has no pre-chosen socket).
 *
 * Tries every orientation and scale candidate for the candidate
 * tile/piece and returns the best-scoring placement, or null if nothing
 * lines up at all (the existing side is sealed, or every candidate
 * orientation is). */
export function bestPlacement(
  existing: PlacedInstance,
  existingTile: ParsedTile,
  existingWorldDir: FaceName,
  candidateTile: ParsedTile,
  candidateTileFt: [number, number, number],
  candidateContentMinFt: [number, number, number],
  candidateContentMaxFt: [number, number, number],
  scaleCandidates: number[],
  overlapFt: number,
  existingBranchIndex?: number,
): PlacementCandidate | null {
  const joinAxis = AXIS_OF[existingWorldDir];
  const sign = existingWorldDir.startsWith("+") ? 1 : -1;
  const [lat0, lat1] = ([0, 1, 2] as const).filter((a) => a !== joinAxis) as [0 | 1 | 2, 0 | 1 | 2];

  const existingLocalFace = localFaceFacing(existingWorldDir, existing.transform);
  const existingBranches = computeFaceBranches(existingTile, existingLocalFace);
  if (existingBranches.length === 0) return null; // existing side sealed (or nothing but voxel noise)
  const branchIndicesToTry =
    existingBranchIndex != null ? [existingBranchIndex] : existingBranches.map((_, i) => i);

  const existingExtent = transformedContentExtent(
    existing.contentMinFt,
    existing.contentMaxFt,
    existing.tileFt,
    existing.transform,
    existing.transform.scale,
  );
  const existingBoundary = existing.transform.positionFt[joinAxis] + (sign > 0 ? existingExtent.max[joinAxis] : existingExtent.min[joinAxis]);

  const candidateWorldDir = OPPOSITE[existingWorldDir];
  let best: PlacementCandidate | null = null;

  // The existing side's cell set only depends on which of ITS branches and
  // which scale we're checking against — never on the candidate's own
  // orientation or which of ITS branches — so it's prepared once per
  // (existingBranch, scale) here and re-used across all 48 orientations and
  // every candidate branch, instead of rebuilt on every single trial.
  for (const ebi of branchIndicesToTry) {
    const existingBranch = existingBranches[ebi];
    for (const scale of scaleCandidates) {
      const bucketFt = CELL_FT * Math.max(existing.transform.scale, scale, 0.05);
      const prepared = prepareExistingBranch(
        existingTile,
        existingBranch,
        existing.tileFt,
        existing.transform,
        existing.transform.scale,
        existing.transform.positionFt,
        lat0,
        lat1,
        bucketFt,
      );
      if (!prepared) continue;

      // Pass 1 (cheap): every (orientation, candidate branch) combo scored
      // at a single naive offset, no local search yet.
      interface RankedCandidate {
        orientation: Orientation;
        candidateLocalFace: FaceName;
        candidateBranchIndex: number;
        projected: ProjectedBranch;
        positionOnAxis: number;
        quickScore: number;
      }
      const ranked: RankedCandidate[] = [];
      for (const orientation of SEARCH_ORIENTATIONS) {
        const candidateLocalFace = localFaceFacing(candidateWorldDir, orientation);
        const candidateBranches: FaceBranch[] = computeFaceBranches(candidateTile, candidateLocalFace);
        if (candidateBranches.length === 0) continue;

        const candidateExtent = transformedContentExtent(candidateContentMinFt, candidateContentMaxFt, candidateTileFt, orientation, scale);
        const candidateBoundaryOffset = sign > 0 ? candidateExtent.min[joinAxis] : candidateExtent.max[joinAxis];
        const positionOnAxis = existingBoundary - sign * overlapFt - candidateBoundaryOffset;

        for (let cbi = 0; cbi < candidateBranches.length; cbi++) {
          const projected = projectCandidateBranch(candidateTile, candidateBranches[cbi], candidateTileFt, orientation, scale, lat0, lat1);
          if (!projected) continue;
          ranked.push({ orientation, candidateLocalFace, candidateBranchIndex: cbi, projected, positionOnAxis, quickScore: quickScore(prepared, projected, lat0, lat1) });
        }
      }
      if (ranked.length === 0) continue;

      // Pass 2 (expensive): only the best-looking few get the full local
      // refinement search, PLUS a depth-continuity check at the alignment
      // that search finds — checked here, not only against the single
      // already-chosen winner, so a great-surface/bad-depth candidate that
      // gets correctly capped doesn't silently block a good-surface/
      // good-depth #2 or #3 from ever being promoted in its place.
      ranked.sort((a, b) => b.quickScore - a.quickScore);
      for (const cand of ranked.slice(0, REFINE_TOP_K)) {
        const refined = refineAlignment(prepared, cand.projected, lat0, lat1);
        if (best && refined.score <= best.score) continue; // can't beat the current best on surface alone — depth can only lower it further, skip early

        const depthScore = depthCompatibility(
          existingTile,
          existing.transform,
          existingLocalFace,
          prepared.set,
          candidateTile,
          cand.orientation,
          scale,
          cand.candidateLocalFace,
          cand.projected.cells,
          refined.lateralPositionFt,
          lat0,
          lat1,
          prepared.bucketFt,
        );
        const combined = depthScore === null ? refined.score : Math.min(refined.score, depthScore);
        if (best && combined <= best.score) continue;

        const positionFt: [number, number, number] = [0, 0, 0];
        positionFt[joinAxis] = cand.positionOnAxis;
        positionFt[lat0] = refined.lateralPositionFt[0];
        positionFt[lat1] = refined.lateralPositionFt[1];
        best = { orientation: cand.orientation, positionFt, scale, score: combined, surfaceScore: refined.score, depthScore, candidateBranchIndex: cand.candidateBranchIndex };
      }
    }
  }

  return best;
}
