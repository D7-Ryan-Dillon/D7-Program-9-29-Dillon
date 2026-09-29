// Checks that two joining openings' voids stay compatible a bit BEHIND the
// surface, not just at the face itself — using sections.json data
// (lib/types.ts's SectionEntry), which the exporter already computes at
// several depths per axis but nothing else in this app reads.
//
// lib/arrange/shapeMatch.ts's surface IoU can score two openings as a
// great match right at the joining plane even when they diverge completely
// a foot behind it — these voids are organic, not prismatic, so "the
// silhouettes line up at the surface" doesn't imply "the space actually
// continues". That gap is what let joints through that were technically
// touching but read as barely-touching moments rather than a real
// passage. This file adds a second, independent check at one or two real
// depths behind the surface, combined with the surface score by MIN (not
// a blend, not a multiplier like lib/arrange/flowCompatibility.ts): a bad
// depth sample caps the match regardless of how good the surface
// alignment looks, matching the same refuse-rather-than-force philosophy
// lib/arrange/autoGenerate.ts's MIN_ACCEPTABLE_SCORE already uses.
//
// Only 8 sections exist per axis (~2.5 ft apart on a 20 ft tile), so "a
// bit behind the surface" is honestly close to one meaningfully distinct
// sample most of the time (COMBINE_DEPTH_STEPS below caps at 2). Worth
// being upfront about: this is the real resolution the source data has,
// not a resolution this file chose to skimp on.
//
// A section's outline_uv_ft is already decomposed into separate rings by
// the exporter — unlike a face mask, which lib/faceBranches.ts has to
// flood-fill to discover components in the first place, picking the right
// ring here is a SELECTION problem: which of possibly several rings at
// that depth is the one this specific branch actually continues into.
// Solved the same way as everywhere else in this codebase's matching code
// solves "does this belong to that opening" — by real spatial overlap
// (rasterize the ring, keep it only if it overlaps the branch's own
// bucketed footprint), not a guess based on which ring looks closest.

import type { FaceName, ParsedTile, SectionEntry } from "@/lib/types";
import type { InstanceTransform } from "./types";
import { bucketKey, iouOfSets, type ProjectedCell } from "./shapeMatch";
import type { Orientation } from "./transforms";
import { transformPointFt } from "./transforms";

const AXIS_OF: Record<FaceName, 0 | 1 | 2> = {
  "+X": 0,
  "-X": 0,
  "+Y": 1,
  "-Y": 1,
  "+Z": 2,
  "-Z": 2,
};

const AXIS_LETTER = ["X", "Y", "Z"] as const;

// How many depth slices behind the joining face get checked, combined by
// MIN — see file comment for why 2 is close to the real ceiling here, not
// an arbitrary choice.
const MAX_DEPTH_STEPS = 2;

/** A tile's own sections along one local face's axis, ordered nearest that
 * face to farthest (so index 0 is always "just behind this specific
 * face", regardless of which end of the tile it actually is). */
function sectionsNearFace(tile: ParsedTile, localFace: FaceName): SectionEntry[] {
  const letter = AXIS_LETTER[AXIS_OF[localFace]];
  const sign = localFace.startsWith("+") ? 1 : -1;
  const all = tile.sections.sections.filter((s) => s.axis === letter);
  return sign > 0 ? [...all].sort((a, b) => b.position_ft - a.position_ft) : [...all].sort((a, b) => a.position_ft - b.position_ft);
}

/** One section outline ring, in a tile's own local feet frame, converted
 * to a (lat0,lat1) world-ish point per vertex — the exact same
 * plane-to-local-to-world pipeline lib/arrange/shapeMatch.ts's
 * projectBranchCells uses for face-mask cells, just fed a section's own
 * `plane` and a polygon ring instead of a mask cell centre. `positionFt`
 * can be [0,0,0] to get points relative to the instance's own centre
 * (the candidate side, before its lateral offset is known) instead of
 * absolute world coordinates (the existing side, already placed). */
function ringToLatLat(
  tile: ParsedTile,
  section: SectionEntry,
  ring: number[][],
  tileFt: [number, number, number],
  o: Orientation,
  scale: number,
  positionFt: [number, number, number],
  lat0: 0 | 1 | 2,
  lat1: 0 | 1 | 2,
): [number, number][] {
  const plane = section.plane;
  return ring.map(([u, v]) => {
    const local: [number, number, number] = [
      plane.origin_ft[0] + plane.u_axis[0] * u + plane.v_axis[0] * v,
      plane.origin_ft[1] + plane.u_axis[1] * u + plane.v_axis[1] * v,
      plane.origin_ft[2] + plane.u_axis[2] * u + plane.v_axis[2] * v,
    ];
    const world = transformPointFt(local, tileFt, o, scale, positionFt);
    return [world[lat0], world[lat1]];
  });
}

/** Even-odd point-in-polygon test — standard ray-cast, nothing
 * project-specific about it. */
function pointInPolygon(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Fills a ring's interior into a Set of bucketed cell keys, restricted to
 * its own bounding box so this stays cheap regardless of how much of the
 * tile the ring covers. Unlike a face mask (already a discrete cell grid),
 * a section outline is a continuous polygon — this is the one genuinely
 * new operation this file needs that lib/arrange/shapeMatch.ts never did. */
function rasterizeRing(ring: [number, number][], bucketFt: number): Set<string> {
  const out = new Set<string>();
  if (ring.length < 3) return out;
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const [a, b] of ring) {
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  const ia0 = Math.floor(minA / bucketFt);
  const ia1 = Math.ceil(maxA / bucketFt);
  const ib0 = Math.floor(minB / bucketFt);
  const ib1 = Math.ceil(maxB / bucketFt);
  for (let ia = ia0; ia <= ia1; ia++) {
    for (let ib = ib0; ib <= ib1; ib++) {
      const cx = (ia + 0.5) * bucketFt;
      const cy = (ib + 0.5) * bucketFt;
      // Same key format as lib/arrange/shapeMatch.ts's bucketKey (which
      // built `branchFootprint`/`prepared.set` below) — call it directly
      // on the cell centre rather than hand-rolling an equivalent string,
      // so the two can never quietly drift out of sync again.
      if (pointInPolygon(cx, cy, ring)) out.add(bucketKey(bucketFt, cx, cy));
    }
  }
  return out;
}

/** The existing side's real void footprint at one depth slice, restricted
 * to whichever ring(s) actually overlap this specific branch (not the
 * section's whole open area — a void with several chambers can have
 * unrelated openings elsewhere in the same slice). Already-placed, so
 * everything is absolute world coordinates directly comparable to
 * `branchFootprint` (lib/arrange/shapeMatch.ts's `prepared.set`). */
function existingSectionFootprint(
  tile: ParsedTile,
  section: SectionEntry,
  transform: InstanceTransform,
  branchFootprint: Set<string>,
  lat0: 0 | 1 | 2,
  lat1: 0 | 1 | 2,
  bucketFt: number,
): Set<string> {
  const out = new Set<string>();
  for (const ring of section.outline_uv_ft) {
    const latLatRing = ringToLatLat(tile, section, ring, tile.tile.tile_ft, transform, transform.scale, transform.positionFt, lat0, lat1);
    const cells = rasterizeRing(latLatRing, bucketFt);
    let overlaps = false;
    cells.forEach((k) => {
      if (branchFootprint.has(k)) overlaps = true;
    });
    if (overlaps) cells.forEach((k) => out.add(k));
  }
  return out;
}

/** The candidate side's real void footprint at one depth slice — computed
 * relative to the candidate's own centre first (matching
 * lib/arrange/shapeMatch.ts's projectCandidateBranch convention, since the
 * candidate isn't placed yet), then shifted by the SAME lateral offset the
 * surface search already found, in continuous space, before rasterizing —
 * not by shifting bucket keys after the fact, which wouldn't make sense
 * for a non-grid-aligned offset. */
function candidateSectionFootprint(
  tile: ParsedTile,
  section: SectionEntry,
  orientation: Orientation,
  scale: number,
  candidateCells: ProjectedCell[],
  lateralOffset: [number, number],
  lat0: 0 | 1 | 2,
  lat1: 0 | 1 | 2,
  bucketFt: number,
): Set<string> {
  const branchFootprint = new Set<string>();
  for (const c of candidateCells) {
    branchFootprint.add(bucketKey(bucketFt, c.world[lat0] + lateralOffset[0], c.world[lat1] + lateralOffset[1]));
  }

  const out = new Set<string>();
  for (const ring of section.outline_uv_ft) {
    const latLatRing = ringToLatLat(tile, section, ring, tile.tile.tile_ft, orientation, scale, [0, 0, 0], lat0, lat1).map(
      ([a, b]): [number, number] => [a + lateralOffset[0], b + lateralOffset[1]],
    );
    const cells = rasterizeRing(latLatRing, bucketFt);
    let overlaps = false;
    cells.forEach((k) => {
      if (branchFootprint.has(k)) overlaps = true;
    });
    if (overlaps) cells.forEach((k) => out.add(k));
  }
  return out;
}

/** 0..1, or null if there's genuinely no section data to check against
 * (defensive only — lib/ingest.ts requires sections.json to exist, so this
 * shouldn't happen in practice). Checked at the SAME lateral offset the
 * surface search already refined to, not a fresh search — this asks "does
 * the alignment the surface already found hold up behind the surface",
 * not "is there some other alignment that works deeper in". Combines
 * multiple depth steps by MIN, so a void that's open at the first slice
 * but pinched shut by the second fails rather than averaging out. */
export function depthCompatibility(
  existingTile: ParsedTile,
  existingTransform: InstanceTransform,
  existingLocalFace: FaceName,
  existingBranchFootprint: Set<string>,
  candidateTile: ParsedTile,
  candidateOrientation: Orientation,
  candidateScale: number,
  candidateLocalFace: FaceName,
  candidateCells: ProjectedCell[],
  lateralOffset: [number, number],
  lat0: 0 | 1 | 2,
  lat1: 0 | 1 | 2,
  bucketFt: number,
): number | null {
  const existingSections = sectionsNearFace(existingTile, existingLocalFace);
  const candidateSections = sectionsNearFace(candidateTile, candidateLocalFace);
  if (existingSections.length === 0 || candidateSections.length === 0) {
    console.warn("[depthMatch] no section data for one side's axis — skipping the depth check for this candidate");
    return null;
  }

  const steps = Math.min(MAX_DEPTH_STEPS, existingSections.length, candidateSections.length);
  let worst = 1;
  for (let i = 0; i < steps; i++) {
    const existingSet = existingSectionFootprint(existingTile, existingSections[i], existingTransform, existingBranchFootprint, lat0, lat1, bucketFt);
    const candidateSet = candidateSectionFootprint(candidateTile, candidateSections[i], candidateOrientation, candidateScale, candidateCells, lateralOffset, lat0, lat1, bucketFt);
    const score = iouOfSets(existingSet, candidateSet);
    if (score < worst) worst = score;
  }
  return worst;
}
