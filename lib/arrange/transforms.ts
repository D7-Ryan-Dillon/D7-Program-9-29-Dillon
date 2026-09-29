// Which local face of a tile ends up pointing in a given world direction
// once an instance's mirror/rotation is applied. Used by the matching
// engine (to know which face's mask to compare) and must stay in exact
// agreement with the rotation lib/arrange/geometry.ts actually bakes into
// the rendered/exported geometry — see the comment there for how tile-feet
// axes (X, Y horizontal, Z up) map onto the glTF's own (metres, Y up) axes,
// and why a tile-Y rotation needs a sign flip there that a tile-X or
// tile-Z rotation doesn't.
//
// Working entirely in tile-feet space here — geometry.ts converts to the
// glTF's metres/Y-up space separately, using the identical composition
// order (mirror, then rotate X, then Y, then Z) so the two stay consistent.

import { FACE_NAMES, type FaceName } from "@/lib/types";

export interface Orientation {
  rotXSteps: 0 | 1 | 2 | 3;
  rotYSteps: 0 | 1 | 2 | 3;
  rotZSteps: 0 | 1 | 2 | 3;
  mirrorX: boolean;
  mirrorY: boolean;
}

export const IDENTITY_ORIENTATION: Orientation = {
  rotXSteps: 0,
  rotYSteps: 0,
  rotZSteps: 0,
  mirrorX: false,
  mirrorY: false,
};

const FACE_NORMALS: Record<FaceName, [number, number, number]> = {
  "+X": [1, 0, 0],
  "-X": [-1, 0, 0],
  "+Y": [0, 1, 0],
  "-Y": [0, -1, 0],
  "+Z": [0, 0, 1],
  "-Z": [0, 0, -1],
};

export const OPPOSITE_FACE: Record<FaceName, FaceName> = {
  "+X": "-X",
  "-X": "+X",
  "+Y": "-Y",
  "-Y": "+Y",
  "+Z": "-Z",
  "-Z": "+Z",
};

/** Every combination auto-generate searches: the 24 proper rotations of a
 * cube times mirror-X on/off (mirror-Y is left to manual mode — a rotation
 * usually reaches an equivalent shape, and folding it in here would double
 * the search for comparatively little extra coverage).
 *
 * Composing three independent 90°-step axis rotations in a fixed order
 * gives 64 raw (rotX,rotY,rotZ) triples, but the cube's rotation group only
 * has 24 elements — most triples land on an orientation some other triple
 * already reached. Deduplicating by each candidate's actual effect (where
 * the 3 basis directions end up) cuts the search to its real size instead
 * of re-testing the same orientation under a different label. */
export const SEARCH_ORIENTATIONS: Orientation[] = (() => {
  const seen = new Map<string, Orientation>();
  const basis: [number, number, number][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (const rotXSteps of [0, 1, 2, 3] as const) {
    for (const rotYSteps of [0, 1, 2, 3] as const) {
      for (const rotZSteps of [0, 1, 2, 3] as const) {
        for (const mirrorX of [false, true]) {
          const o: Orientation = { rotXSteps, rotYSteps, rotZSteps, mirrorX, mirrorY: false };
          const signature = basis.map((v) => transformDirection(v, o).join(",")).join("|");
          if (!seen.has(signature)) seen.set(signature, o);
        }
      }
    }
  }
  return [...seen.values()];
})();

function rotateAxis([x, y, z]: [number, number, number], axis: "x" | "y" | "z", steps: number): [number, number, number] {
  for (let i = 0; i < steps; i++) {
    if (axis === "x") {
      const ny = -z;
      const nz = y;
      y = ny;
      z = nz;
    } else if (axis === "y") {
      const nz = -x;
      const nx = z;
      z = nz;
      x = nx;
    } else {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
  }
  return [x, y, z];
}

export function transformDirection(dir: [number, number, number], o: Orientation): [number, number, number] {
  let [x, y, z] = dir;
  if (o.mirrorX) x = -x;
  if (o.mirrorY) y = -y;
  [x, y, z] = rotateAxis([x, y, z], "x", o.rotXSteps);
  [x, y, z] = rotateAxis([x, y, z], "y", o.rotYSteps);
  [x, y, z] = rotateAxis([x, y, z], "z", o.rotZSteps);
  return [x, y, z];
}

function nearestFace([x, y, z]: [number, number, number]): FaceName {
  const abs = [Math.abs(x), Math.abs(y), Math.abs(z)];
  const i = abs.indexOf(Math.max(...abs));
  if (i === 0) return x >= 0 ? "+X" : "-X";
  if (i === 1) return y >= 0 ? "+Y" : "-Y";
  return z >= 0 ? "+Z" : "-Z";
}

/** Given an orientation, which local face ends up pointing world-direction `worldDir`? */
export function localFaceFacing(worldDir: FaceName, o: Orientation): FaceName {
  for (const face of FACE_NAMES) {
    if (nearestFace(transformDirection(FACE_NORMALS[face], o)) === worldDir) return face;
  }
  return worldDir; // unreachable — the 6 faces always partition all axis directions
}

/** Transforms a point in a tile's own local feet frame (mirror, then
 * rotate X/Y/Z, then scale, all about the tile's own centre, then move to
 * `positionFt`) — the same composition geometry.ts applies to the actual
 * mesh, kept here in plain tile-feet space for the matching engine. */
export function transformPointFt(
  local: [number, number, number],
  tileFt: [number, number, number],
  o: Orientation,
  scale: number,
  positionFt: [number, number, number],
): [number, number, number] {
  let x = local[0] - tileFt[0] / 2;
  let y = local[1] - tileFt[1] / 2;
  let z = local[2] - tileFt[2] / 2;
  if (o.mirrorX) x = -x;
  if (o.mirrorY) y = -y;
  [x, y, z] = rotateAxis([x, y, z], "x", o.rotXSteps);
  [x, y, z] = rotateAxis([x, y, z], "y", o.rotYSteps);
  [x, y, z] = rotateAxis([x, y, z], "z", o.rotZSteps);
  return [x * scale + positionFt[0], y * scale + positionFt[1], z * scale + positionFt[2]];
}

/** The world-axis-aligned bounding box of a (possibly off-centre) local
 * content region once mirrored/rotated/scaled, relative to where the
 * instance's own position (its tile-centre) ends up — i.e. add the
 * instance's positionFt to get the box in true world coordinates. Corner
 * transformation handles arbitrary 90°-rotations correctly without having
 * to reason case-by-case about which local axis lands on which world axis. */
export function transformedContentExtent(
  contentMinFt: [number, number, number],
  contentMaxFt: [number, number, number],
  tileFt: [number, number, number],
  o: Orientation,
  scale: number,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const x of [contentMinFt[0], contentMaxFt[0]]) {
    for (const y of [contentMinFt[1], contentMaxFt[1]]) {
      for (const z of [contentMinFt[2], contentMaxFt[2]]) {
        const p = transformPointFt([x, y, z], tileFt, o, scale, [0, 0, 0]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
      }
    }
  }
  return { min, max };
}
