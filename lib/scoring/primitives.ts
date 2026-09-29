// Turns a loaded tile's raw metrics (tile.json/faces.json/sections.json —
// everything the erosion engine already computed) into the smaller set of
// geometric quantities the 12 descriptor scorers actually read. Nothing in
// here is descriptor-specific; see engine.ts for that.
//
// Field names below are read directly from erosion_engine_5f.py's
// tile_metrics()/export_bundle() (the "8 ft2 counts as a real opening"
// threshold, the face-open-area convention, etc. all come from there and
// from HANDOFF.md section 5), not guessed.

import { FACE_NAMES, type FaceName, type ParsedTile } from "@/lib/types";
import { computeFaceBranches } from "@/lib/faceBranches";
import { clamp, clusterLevels } from "./utils";

export interface FloorLevel {
  zFt: number;
  areaFt2: number;
}

export interface ParsedSource {
  mode: string;
  doseFt3: number;
  hasDirection: boolean;
}

export interface TilePrimitives {
  cellFt: number;
  tileHeightFt: number;

  voidFractionPct: number;
  retainedFractionPct: number;
  voidPieces: number;

  faceOpenAreaFt2: Record<FaceName, number>;
  faceOpenFraction: Record<FaceName, number>;
  facesReached: FaceName[]; // open_area_ft2 >= OPENING_THRESHOLD_FT2 (HANDOFF section 5)
  porosityPct: number; // open area on the 6 faces as a % of the void's total mesh surface

  // Per-face mask decomposed into its actual connected openings (see
  // lib/faceBranches.ts) rather than one collapsed open-area number — e.g.
  // two separate 3 ft2 windows on the same face are 2 distinct openings,
  // not "this face is open". Used where a descriptor is literally about
  // distinct routes/openings, not total open area.
  totalBranches: number; // real openings across all 6 faces
  branchAreasFt2: number[]; // every real opening's own area, flattened

  floorLevels: FloorLevel[]; // low to high, noise-filtered
  ceilingLevels: FloorLevel[];

  voidHeightFt: number;
  voidWidthFt: number; // larger of the void bbox's X/Y extents
  heightToWidthRatio: number;

  sequenceAxis: "x" | "y" | "z";
  sequenceProfileFt2: number[];
  narrowestFt2: number;
  widestFt2: number;
  compressionRatio: number; // narrowest / widest, 0..1

  verticalProfileFt2: number[]; // void cross-section area at every Z slice, base to top

  skylightPct: number; // +Z open area as a % of the void's base floor area

  meshSmoothnessRatio: number; // void_mesh_area_ft2 / voxel_wall_area_ft2 (blocky estimate)
  layered: boolean;
  layerCount: number;
  layerStrength: number;
  webStrength: number;
  smoothParam: number;

  sources: ParsedSource[];
  totalDoseFt3: number;
  doseConcentration: number; // biggest source's share of total dose, 0..1
  dominantMode: string;
  gravity: number;
}

const OPENING_THRESHOLD_FT2 = 8; // HANDOFF section 5: openings under ~8 ft2 aren't counted as real ports
const FLOOR_NOISE_FT2 = 4; // a patch smaller than this is rough-foam noise, not a level (HANDOFF section 8)

function parseSources(raw: string[]): ParsedSource[] {
  const out: ParsedSource[] = [];
  for (const item of raw) {
    try {
      const d = JSON.parse(item);
      out.push({
        mode: typeof d.mode === "string" ? d.mode : "unknown",
        doseFt3: typeof d.dose === "number" ? d.dose : 0,
        hasDirection: d.dir != null,
      });
    } catch {
      // malformed source entry — skip rather than fail the whole tile
    }
  }
  return out;
}

export function computePrimitives(tile: ParsedTile): TilePrimitives {
  const t = tile.tile;
  const m = t.metrics;
  const cellFt = t.cell_ft;

  const voidFractionPct = m.void_fraction * 100;
  const retainedFractionPct = 100 - voidFractionPct;

  const faceOpenAreaFt2 = {} as Record<FaceName, number>;
  const faceOpenFraction = {} as Record<FaceName, number>;
  const facesReached: FaceName[] = [];
  for (const f of FACE_NAMES) {
    const fm = m.faces[f];
    faceOpenAreaFt2[f] = fm.open_area_ft2;
    faceOpenFraction[f] = fm.open_fraction;
    if (fm.open_area_ft2 >= OPENING_THRESHOLD_FT2) facesReached.push(f);
  }

  const porosityPct = m.void_mesh_area_ft2 > 0 ? (m.open_area_on_faces_ft2 / m.void_mesh_area_ft2) * 100 : 0;

  let totalBranches = 0;
  const branchAreasFt2: number[] = [];
  for (const f of FACE_NAMES) {
    for (const branch of computeFaceBranches(tile, f)) {
      totalBranches++;
      branchAreasFt2.push(branch.areaFt2);
    }
  }

  const floorClusters = clusterLevels(m.floor_area_by_z_ft2, FLOOR_NOISE_FT2);
  const ceilingClusters = clusterLevels(m.ceiling_area_by_z_ft2, FLOOR_NOISE_FT2);
  const floorLevels: FloorLevel[] = floorClusters.map((c) => ({ zFt: (c.index + 0.5) * cellFt, areaFt2: c.area }));
  const ceilingLevels: FloorLevel[] = ceilingClusters.map((c) => ({ zFt: (c.index + 0.5) * cellFt, areaFt2: c.area }));

  const bbox = m.void_bbox;
  const voidHeightFt = bbox ? bbox.max_ft[2] - bbox.min_ft[2] : 0;
  const voidWidthFt = bbox ? Math.max(bbox.max_ft[0] - bbox.min_ft[0], bbox.max_ft[1] - bbox.min_ft[1]) : 0;
  const heightToWidthRatio = voidWidthFt > 0 ? voidHeightFt / voidWidthFt : 0;

  // "the sequence" a person moves through: pick whichever axis swings most
  // between its narrowest and widest cross-section — that's the axis where
  // a compress-then-release move would actually read.
  const profiles: { axis: "x" | "y" | "z"; values: number[] }[] = [
    { axis: "x", values: m.void_area_profile_ft2.x },
    { axis: "y", values: m.void_area_profile_ft2.y },
    { axis: "z", values: m.void_area_profile_ft2.z },
  ];
  let best = profiles[0];
  let bestSpread = -1;
  for (const p of profiles) {
    const nz = p.values.filter((v) => v > 0);
    if (nz.length < 2) continue;
    const spread = Math.max(...nz) / Math.max(Math.min(...nz), 1e-6);
    if (spread > bestSpread) {
      bestSpread = spread;
      best = p;
    }
  }
  const nzBest = best.values.filter((v) => v > 0);
  const narrowestFt2 = nzBest.length ? Math.min(...nzBest) : 0;
  const widestFt2 = nzBest.length ? Math.max(...nzBest) : 0;
  const compressionRatio = widestFt2 > 0 ? narrowestFt2 / widestFt2 : 1;

  const baseFloorAreaFt2 = floorLevels.length > 0 ? floorLevels[0].areaFt2 : m.floor_area_total_ft2;
  const skylightPct = baseFloorAreaFt2 > 0 ? (faceOpenAreaFt2["+Z"] / baseFloorAreaFt2) * 100 : 0;

  const meshSmoothnessRatio = m.voxel_wall_area_ft2 > 0 ? m.void_mesh_area_ft2 / m.voxel_wall_area_ft2 : 1;

  const foam = t.config.foam;
  const sources = parseSources(t.config.sources);
  const totalDoseFt3 = sources.reduce((a, s) => a + s.doseFt3, 0);
  const maxDose = sources.reduce((a, s) => Math.max(a, s.doseFt3), 0);
  const doseConcentration = totalDoseFt3 > 0 ? maxDose / totalDoseFt3 : 0;
  const dominantSource = sources.reduce((best, s) => (s.doseFt3 > (best?.doseFt3 ?? -1) ? s : best), sources[0]);

  return {
    cellFt,
    tileHeightFt: t.tile_ft[2],
    voidFractionPct,
    retainedFractionPct,
    voidPieces: m.void_pieces,
    faceOpenAreaFt2,
    faceOpenFraction,
    facesReached,
    porosityPct,
    totalBranches,
    branchAreasFt2,
    floorLevels,
    ceilingLevels,
    voidHeightFt,
    voidWidthFt,
    heightToWidthRatio,
    sequenceAxis: best.axis,
    sequenceProfileFt2: best.values,
    narrowestFt2,
    widestFt2,
    compressionRatio: clamp(compressionRatio, 0, 1),
    verticalProfileFt2: m.void_area_profile_ft2.z,
    skylightPct,
    meshSmoothnessRatio,
    layered: foam.layers,
    layerCount: foam.layer_count,
    layerStrength: foam.layer_strength,
    webStrength: foam.web,
    smoothParam: t.config.smooth,
    sources,
    totalDoseFt3,
    doseConcentration,
    dominantMode: dominantSource?.mode ?? "unknown",
    gravity: t.config.gravity,
  };
}
