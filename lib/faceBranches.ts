// Connected-component decomposition of a tile face's opening mask
// (faces.json's mask_rows_6in — a fixed 6" grid, chosen by the exporter
// specifically so it's comparable between tiles regardless of native cell
// size; see HANDOFF section 5). A "branch" is one maximal 4-connected run
// of open cells: a physically distinct reach/opening on that face, as
// opposed to the face's total open area collapsed into one number.
//
// Shared by:
//  - lib/scoring (Porous / Non-hierarchical Circulation: how many distinct
//    openings a face actually has, not just how much area is open in
//    total)
//  - lib/arrange/matching (branch-to-branch shape alignment, so two placed
//    pieces join where their openings actually correspond in shape and
//    position, not just "this face and that face both have some opening
//    somewhere")
//
// Computed once per (tile, face) and memoized by the FaceEntry object
// itself (stable for a loaded tile's lifetime) — both callers ask for the
// same tile's branches repeatedly.

import type { FaceEntry, FaceName, ParsedTile } from "./types";

export const CELL_FT = 0.5; // mask_rows_6in resolution
const CELL_AREA_FT2 = CELL_FT * CELL_FT;

// A lone cell or two is almost always voxelization noise at this
// resolution, not a real, usable opening. HANDOFF's "8 ft2" threshold is
// for how much of a whole face must be open to call it "reached" at all;
// a branch is a sub-region of that, so a smaller cutoff here is deliberate
// — small enough to keep genuinely distinct small openings, large enough
// to drop single/double-cell speckle.
export const MIN_BRANCH_AREA_FT2 = 1.5;

export interface FaceBranch {
  faceName: FaceName;
  /** Cells as [row, col] into the face's mask_rows_6in grid. */
  cells: [number, number][];
  areaFt2: number;
  /** Cell-index centroid — a first-guess anchor before any lateral search. */
  centroidRC: [number, number];
  rowRange: [number, number];
  colRange: [number, number];
}

function floodFillBranches(rows: string[]): [number, number][][] {
  const nRows = rows.length;
  const visited: boolean[][] = rows.map((r) => new Array(r.length).fill(false));
  const groups: [number, number][][] = [];

  for (let r = 0; r < nRows; r++) {
    const line = rows[r];
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== "1" || visited[r][c]) continue;
      const group: [number, number][] = [];
      const stack: [number, number][] = [[r, c]];
      visited[r][c] = true;
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        group.push([cr, cc]);
        const neighbors: [number, number][] = [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ];
        for (const [nr, nc] of neighbors) {
          if (nr < 0 || nr >= nRows) continue;
          const nline = rows[nr];
          if (nc < 0 || nc >= nline.length) continue;
          if (visited[nr][nc] || nline[nc] !== "1") continue;
          visited[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
      groups.push(group);
    }
  }
  return groups;
}

function toBranch(faceName: FaceName, cells: [number, number][]): FaceBranch {
  let rMin = Infinity;
  let rMax = -Infinity;
  let cMin = Infinity;
  let cMax = -Infinity;
  let rSum = 0;
  let cSum = 0;
  for (const [r, c] of cells) {
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
    cMin = Math.min(cMin, c);
    cMax = Math.max(cMax, c);
    rSum += r;
    cSum += c;
  }
  return {
    faceName,
    cells,
    areaFt2: cells.length * CELL_AREA_FT2,
    centroidRC: [rSum / cells.length, cSum / cells.length],
    rowRange: [rMin, rMax],
    colRange: [cMin, cMax],
  };
}

const branchCache = new WeakMap<FaceEntry, FaceBranch[]>();

/** All real (non-noise) branches on one face of a tile, largest first. */
export function computeFaceBranches(tile: ParsedTile, faceName: FaceName): FaceBranch[] {
  const face = tile.faces.faces[faceName];
  const cached = branchCache.get(face);
  if (cached) return cached;

  const groups = floodFillBranches(face.mask_rows_6in);
  const branches = groups
    .map((cells) => toBranch(faceName, cells))
    .filter((b) => b.areaFt2 >= MIN_BRANCH_AREA_FT2)
    .sort((a, b) => b.areaFt2 - a.areaFt2);

  branchCache.set(face, branches);
  return branches;
}
