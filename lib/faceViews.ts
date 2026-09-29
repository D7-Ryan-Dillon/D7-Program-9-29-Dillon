// Camera directions for the 6 named orthographic views + free orbit,
// using Rhino's own naming (Top/Bottom/Front/Back/Left/Right/Perspective)
// so it's immediately familiar.
//
// Mapping to Rhino convention: Top/Bottom look straight down/up the
// vertical axis; Front/Back/Left/Right are the four side faces. Which tile
// face is "Front" vs "Back" is an arbitrary but fixed choice (there's no
// inherent front to a cube), picked to match Rhino's own axis convention:
// Front = the -Y side, Back = +Y, Right = +X, Left = -X.
//
// Directions are given in the GLB's own local space (glTF: metres, Y up).
// The exporter's write_glb() converts tile feet (X,Y horizontal, Z up) to
// glTF (metres, Y up) via (x, z, -y) — i.e. tile +Y maps to glTF -Z. Three
// values below are unit vectors in glTF/three.js space, derived from that
// exact mapping (see erosion_engine_5f.py write_glb / HANDOFF section 3),
// not eyeballed. Because glTF Y is already "up", camera.up = (0,1,0) for
// every side view.

import type { FaceName } from "./types";

export type NamedView =
  | "Perspective"
  | "Top"
  | "Bottom"
  | "Front"
  | "Back"
  | "Left"
  | "Right";

export const NAMED_VIEWS: NamedView[] = [
  "Perspective",
  "Top",
  "Front",
  "Right",
  "Back",
  "Left",
  "Bottom",
];

export interface FaceViewDef {
  /** Unit vector, in glTF-local space, from the tile center to the camera. */
  dir: [number, number, number];
  /** Camera up vector, in glTF-local space. */
  up: [number, number, number];
  /** The tile face (handoff convention) this view looks at, for cross-reference
   * with the exported face images/faces.json. */
  face: FaceName;
}

export const NAMED_VIEW_DEFS: Partial<Record<NamedView, FaceViewDef>> = {
  Right: { dir: [1, 0, 0], up: [0, 1, 0], face: "+X" },
  Left: { dir: [-1, 0, 0], up: [0, 1, 0], face: "-X" },
  Back: { dir: [0, 0, -1], up: [0, 1, 0], face: "+Y" },
  Front: { dir: [0, 0, 1], up: [0, 1, 0], face: "-Y" },
  Top: { dir: [0, 1, 0], up: [0, 0, -1], face: "+Z" },
  Bottom: { dir: [0, -1, 0], up: [0, 0, -1], face: "-Z" },
};
