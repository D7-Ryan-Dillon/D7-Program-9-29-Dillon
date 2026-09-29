// Turns a PlacedInstance into an actual transform matrix in the glTF's own
// space (metres, Y up), loads/caches each source tile's GLB, and merges the
// whole composition into one THREE.BufferGeometry for the live viewport and
// for OBJ export.
//
// Feet -> metres conversion matches the exporter's own to_tile_ft_row_major
// (HANDOFF section 2: x_ft = F*x_m, y_ft = -F*z_m, z_ft = F*y_m), inverted
// here to go from a tile-feet position/size back to glTF metres. Mirror and
// rotation are applied about each tile's own centre (mirrorX -> glTF X,
// mirrorY -> glTF Z per that same axis mapping), matching HANDOFF's "mirror
// first, then rotation, then translation" order and the same handedness
// lib/arrange/transforms.ts uses to decide which face ends up where — the
// two must stay in agreement, or a "matched" orientation would render
// facing the wrong way.
//
// The three rotation steppers are tile-feet rotations (X, Y horizontal, Z
// up) and only tile-Y needs a sign flip once translated to glTF axes: since
// tile-X = glTF X and tile-Z = glTF Y directly (same sign), a rotation
// about either carries over unchanged, but tile-Y = -glTF Z, so a rotation
// about tile-Y is a rotation about glTF Z by the *negative* of the same
// angle (rotating about the negative of an axis by +θ is rotating about
// the positive axis by -θ) — verified by conjugating the axis-mapping
// matrix, not guessed.

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import type { PieceKind, PlacedInstance } from "./types";

export const FEET_PER_METRE = 3.280839895013123;

const gltfCache = new Map<string, Promise<GLTF>>();

function loadGltf(url: string): Promise<GLTF> {
  let p = gltfCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
}

export function findPieceMesh(root: THREE.Object3D, name: PieceKind): THREE.Mesh | null {
  let obj: THREE.Object3D | undefined = root.getObjectByName(name);
  if (obj && !(obj instanceof THREE.Mesh)) {
    obj = obj.children.find((c) => c instanceof THREE.Mesh);
  }
  return obj instanceof THREE.Mesh ? obj : null;
}

/** The affine matrix (glTF metres/Y-up space) for one placed instance:
 * re-centre on the tile's own middle, mirror, rotate, scale, then move to
 * its world position. */
export function instanceMatrix(inst: PlacedInstance): THREE.Matrix4 {
  const t = inst.transform;
  const centerFt = inst.tileFt.map((d) => d / 2) as [number, number, number];
  const centerM = new THREE.Vector3(centerFt[0] / FEET_PER_METRE, centerFt[2] / FEET_PER_METRE, -centerFt[1] / FEET_PER_METRE);
  const preCenter = new THREE.Matrix4().makeTranslation(-centerM.x, -centerM.y, -centerM.z);

  const positionM = new THREE.Vector3(
    t.positionFt[0] / FEET_PER_METRE,
    t.positionFt[2] / FEET_PER_METRE,
    -t.positionFt[1] / FEET_PER_METRE,
  );
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (t.rotXSteps * Math.PI) / 2);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (-t.rotYSteps * Math.PI) / 2);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t.rotZSteps * Math.PI) / 2);
  const quat = qz.multiply(qy).multiply(qx); // compose in the same X-then-Y-then-Z order as transforms.ts
  const scale = new THREE.Vector3(t.scale * (t.mirrorX ? -1 : 1), t.scale, t.scale * (t.mirrorY ? -1 : 1));
  const trs = new THREE.Matrix4().compose(positionM, quat, scale);

  return trs.multiply(preCenter);
}

/** `pieceMode` picks which of the tile's two meshes to load — a global
 * view choice (see lib/arrange/types.ts), not a property of the instance
 * itself, so the same instance can be re-skinned foam<->void without
 * touching its placement. */
export async function loadInstanceGeometry(inst: PlacedInstance, pieceMode: PieceKind): Promise<THREE.BufferGeometry | null> {
  const gltf = await loadGltf(inst.glbUrl);
  const mesh = findPieceMesh(gltf.scene, pieceMode);
  if (!mesh) return null;
  const geom = mesh.geometry.clone();
  if (!geom.attributes.normal) geom.computeVertexNormals();
  return geom;
}

export async function buildMergedGeometry(instances: PlacedInstance[], pieceMode: PieceKind): Promise<THREE.BufferGeometry | null> {
  const geometries: THREE.BufferGeometry[] = [];
  for (const inst of instances) {
    const geom = await loadInstanceGeometry(inst, pieceMode);
    if (!geom) continue;
    geom.applyMatrix4(instanceMatrix(inst));
    geometries.push(geom);
  }
  if (geometries.length === 0) return null;
  return mergeGeometries(geometries, false);
}

export function exportObj(geometry: THREE.BufferGeometry): string {
  return new OBJExporter().parse(new THREE.Mesh(geometry));
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
