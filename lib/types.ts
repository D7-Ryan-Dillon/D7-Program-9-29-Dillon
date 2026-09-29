// Typed shapes for a `<tile_name>_analysis` bundle exported by the
// Grasshopper erosion engine (engine_version "5f", schema "erosion-tile/3").
// Field names here are taken directly from erosion_engine_5f.py's
// export_bundle(), tile_metrics(), and the HANDOFF doc — not guessed.

export type FaceName = "-X" | "+X" | "-Y" | "+Y" | "-Z" | "+Z";

export const FACE_NAMES: FaceName[] = ["-X", "+X", "-Y", "+Y", "-Z", "+Z"];

// ---------------------------------------------------------------- manifest
export interface ManifestFileEntry {
  file: string; // path relative to the _analysis root, e.g. "data/faces.json"
  role: string; // e.g. "tile.json", "model.glb", "data.faces", "image.face.color"
  what: string; // human description
  // Extra attributes vary by role: face, axis, index, position_ft, plane,
  // white_is_ft, to_tile_ft_row_major, nodes, dtype, layout, etc.
  [key: string]: unknown;
}

export interface VoxelLayout {
  order: "C";
  axes: ["x", "y", "z"];
  shape: [number, number, number];
  index: string; // "(x * ny + y) * nz + z"
  endian: "little";
}

export interface Manifest {
  schema: string;
  id: string;
  name: string;
  tile_ft: [number, number, number];
  cell_ft: number;
  grid: [number, number, number];
  units: "feet";
  voxel_layout: VoxelLayout;
  files: ManifestFileEntry[];
  problems: string[];
}

// ---------------------------------------------------------------- faces.json
export interface ImagePlane {
  seen_from: string;
  origin_ft: [number, number, number];
  u_axis: [number, number, number];
  v_axis: [number, number, number];
  width_ft: number;
  height_ft: number;
  size_px: [number, number];
  px_per_ft: number;
  pixel_rule: string;
}

export interface FaceEdges {
  first_axis_min: string;
  first_axis_max: string;
  second_axis_min: string;
  second_axis_max: string;
}

export interface FaceEntry {
  stored_axes: [string, string];
  mask_rows: string[];
  mask_rows_6in: string[];
  depth_cells: number[][];
  open_cells: number;
  open_area_ft2: number;
  edges: FaceEdges;
  max_depth_ft: number;
  outline_uv_ft: number[][][];
  plane: ImagePlane;
}

export interface FacesJson {
  schema: string;
  note: string;
  cell_ft: number;
  faces: Record<FaceName, FaceEntry>;
}

// -------------------------------------------------------------- sections.json
export interface SectionEntry {
  axis: "X" | "Y" | "Z";
  index: number;
  position_ft: number;
  seen_from: string;
  void_area_ft2: number;
  void_fraction: number;
  outline_uv_ft: number[][][];
  plane: ImagePlane;
}

export interface SectionsJson {
  schema: string;
  sections: SectionEntry[];
}

// ------------------------------------------------------------------ tile.json
export interface VoidComponent {
  id: number;
  volume_ft3: number;
  bbox_min_ft: [number, number, number];
  bbox_max_ft: [number, number, number];
  touches_faces_open_area_ft2: Partial<Record<FaceName, number>>;
}

export interface FaceMetric {
  open_cells: number;
  open_area_ft2: number;
  open_fraction: number;
}

export interface VoidBBox {
  min_ft: [number, number, number];
  max_ft: [number, number, number];
  centroid_ft: [number, number, number];
}

export interface TileMetrics {
  void_volume_ft3: number;
  tile_volume_ft3: number;
  void_fraction: number;
  foam_volume_ft3: number;
  void_pieces: number;
  largest_void_ft3: number;
  void_components: VoidComponent[];
  faces: Record<FaceName, FaceMetric>;
  open_area_on_faces_ft2: number;
  void_bbox: VoidBBox | null;
  void_z_range_ft: [number, number] | null;
  void_mesh_area_ft2: number;
  void_wall_area_ft2_estimate: number;
  foam_mesh_area_ft2: number;
  voxel_wall_area_ft2: number;
  floor_area_by_z_ft2: number[];
  ceiling_area_by_z_ft2: number[];
  floor_area_total_ft2: number;
  void_area_profile_ft2: { x: number[]; y: number[]; z: number[] };
}

export interface TileFoamConfig {
  noise: number;
  scale: number;
  grain: number;
  seed: number;
  web: number;
  web_open: number;
  web_thickness: number;
  layers: boolean;
  layer_count: number;
  layer_axis: number;
  layer_thickness: number;
  layer_strength: number;
}

export interface TileConfig {
  tile_w: number;
  tile_h: number;
  cell: number;
  steps: number;
  gravity: number;
  drain: boolean;
  n_frames: number;
  frame: number;
  smooth: number;
  seed: number;
  sources: string[];
  foam: TileFoamConfig;
  min_void_ft3: number;
  min_foam_ft3: number;
  weld: string;
}

export interface TileJson {
  schema: string;
  id: string;
  name: string;
  exported: string;
  engine_version: string;
  units: "feet";
  coordinate_system: string;
  tile_ft: [number, number, number];
  cell_ft: number;
  grid: [number, number, number];
  frame_exported: number;
  last_frame: number;
  config: TileConfig;
  metrics: TileMetrics;
}

// ------------------------------------------------------------- parsed bundle
export interface ParsedTileName {
  category: string | null; // "Gathering" | "Office" | "Lobby" (best-effort)
  slotNumber: number | null;
  typology: string | null; // human-readable, best-effort
  isNaturalSetV2: boolean; // name ends with _V2 (the natural-erosion iteration)
}

export interface ParsedTile {
  manifest: Manifest;
  tile: TileJson;
  faces: FacesJson;
  sections: SectionsJson;
  glbUrl: string;
  glbNodeNames: string[];
  thumbnailUrl: string | null;
  rootPrefix: string; // folder prefix the manifest was found under, "" if root
  sourceKind: "folder" | "zip";
  parsedName: ParsedTileName;
}
