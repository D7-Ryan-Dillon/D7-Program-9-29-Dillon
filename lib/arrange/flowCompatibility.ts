// How compatible two tiles are as adjacent architectural spaces, derived
// from the SAME descriptor scoring engine that powers the Analysis tab
// (lib/scoring/engine.ts) rather than a separate hand-tuned system. Used as
// a secondary nudge in auto-generate's piece selection: geometry (does the
// opening shape actually line up, and — once lib/arrange/depthMatch.ts's
// check is folded in — does it stay compatible behind the surface too)
// stays the deciding, gating factor; this only breaks ties and near-ties,
// so a generated composition prefers joining spaces whose own spatial
// character reads similarly, rather than yanking between wildly different
// characters at every joint.

import type { ParsedTile } from "@/lib/types";
import { scoreTile } from "@/lib/scoring/engine";

const FLOW_DESCRIPTORS = ["continuous", "threaded", "graduated", "non_hierarchical"] as const;

const flowVectorCache = new WeakMap<ParsedTile, number[]>();

function flowVector(tile: ParsedTile): number[] {
  const cached = flowVectorCache.get(tile);
  if (cached) return cached;
  const scored = scoreTile(tile);
  const vector = FLOW_DESCRIPTORS.map((id) => scored[id].qualitative.score);
  flowVectorCache.set(tile, vector);
  return vector;
}

/** 0..1 — 1 when two tiles' own flow-related descriptors read the same,
 * lower the more their spatial character diverges. Superseded by
 * architecturalCompatibility below for auto-generate's own piece
 * selection, but kept as-is (and exported) since it's a smaller, complete
 * signal on its own — literally about seams, joints and paths, which is
 * exactly what a join is. */
export function flowCompatibility(a: ParsedTile, b: ParsedTile): number {
  if (a === b) return 1;
  const va = flowVector(a);
  const vb = flowVector(b);
  const avgDiff = va.reduce((sum, v, i) => sum + Math.abs(v - vb[i]), 0) / va.length;
  return 1 - avgDiff / 100;
}

// The other 8 of the scoring engine's 12 descriptors — general spatial
// character (how carved, stepped, porous, resistant, force-driven,
// light-filled, monumental, dense) rather than specifically about
// connections. Rounds flowCompatibility out into a fuller picture without
// drowning out the part that's specifically about how spaces join —
// FLOW_WEIGHT keeps the original 4 dominant.
const CHARACTER_DESCRIPTORS = ["carved", "stepped", "porous", "resistant", "force_driven", "light_filled", "monumental", "spatial_density"] as const;
const FLOW_WEIGHT = 0.6;

const characterVectorCache = new WeakMap<ParsedTile, number[]>();

function characterVector(tile: ParsedTile): number[] {
  const cached = characterVectorCache.get(tile);
  if (cached) return cached;
  const scored = scoreTile(tile);
  const vector = CHARACTER_DESCRIPTORS.map((id) => scored[id].qualitative.score);
  characterVectorCache.set(tile, vector);
  return vector;
}

function similarity(va: number[], vb: number[]): number {
  const avgDiff = va.reduce((sum, v, i) => sum + Math.abs(v - vb[i]), 0) / va.length;
  return 1 - avgDiff / 100;
}

/** 0..1 — the richer version of flowCompatibility that lib/arrange/
 * autoGenerate.ts actually scores candidates with: flow descriptors
 * (dominant, per FLOW_WEIGHT) blended with the scoring engine's other 8
 * descriptors, for a fuller sense of whether two tiles read as
 * compatible neighbours, not just whether their joints/paths match.
 * Deliberately does NOT factor in tile category or typology (Gathering/
 * Office/Lobby, or the free-text name) — decided explicitly: neither
 * clustering same-category spaces nor seeking cross-category variety, so
 * this stays purely about how the spaces themselves read, not their
 * label. */
export function architecturalCompatibility(a: ParsedTile, b: ParsedTile): number {
  if (a === b) return 1;
  const flowSim = similarity(flowVector(a), flowVector(b));
  const characterSim = similarity(characterVector(a), characterVector(b));
  return FLOW_WEIGHT * flowSim + (1 - FLOW_WEIGHT) * characterSim;
}
