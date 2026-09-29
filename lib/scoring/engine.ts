// Turns a loaded tile's geometry into a 1-100 score (plus a one-sentence
// explanation) for both the qualitative and quantitative half of each of
// the 12 Assignment 1 Part 3 descriptors. This is a first-pass system built
// entirely from what the erosion engine already exports (tile.json's
// metrics + config, faces.json, sections.json) — see primitives.ts for the
// geometric quantities it reads.
//
// A few descriptors describe design intent rather than pure geometry
// (Threaded, Non-hierarchical Circulation, Force-driven); those are inferred
// from the closest geometric stand-in available (connectivity, face reach,
// dominant source dose). Every other descriptor is scored from a direct or
// lightly-derived geometric measurement.
//
// Nothing here reads the HANDOFF doc's expected-value table — it was used
// only to sanity-check this engine while building it, never as an input.

import type { ParsedTile } from "@/lib/types";
import { computePrimitives, type TilePrimitives } from "./primitives";
import {
  averageRelativeJump,
  clamp,
  coefficientOfVariation,
  countPlateaus,
  normalize,
  triangular,
} from "./utils";

export interface ScoreResult {
  score: number; // 1-100
  explanation: string;
}

export interface DescriptorScore {
  qualitative: ScoreResult;
  quantitative: ScoreResult;
}

export type ScoredDescriptors = Record<string, DescriptorScore>;

const OPENING_THRESHOLD_FT2 = 8;

function pct(n: number, decimals = 0): string {
  return `${n.toFixed(decimals)}%`;
}
function ft2(n: number, decimals = 0): string {
  return `${n.toFixed(decimals)} ft²`;
}
function result(score: number, explanation: string): ScoreResult {
  return { score: Math.round(clamp(score, 1, 100)), explanation };
}

// ---------------------------------------------------------------- Carved
function scoreCarved(p: TilePrimitives): DescriptorScore {
  const sweetSpot = triangular(p.voidFractionPct, 8, 27, 55);
  const pieceBonus = p.voidPieces === 1 ? 15 : p.voidPieces <= 3 ? 0 : -15;
  const qualScore = sweetSpot * 0.85 + pieceBonus;
  const qualitative = result(
    qualScore,
    `${p.voidPieces} void piece(s) at ${pct(p.voidFractionPct)} void — ` +
      (qualScore >= 60
        ? "reads as a single carved mass."
        : qualScore >= 35
          ? "a legible but partial carving."
          : "too little or too fragmented to read as one carved gesture."),
  );

  const rawReductionPct = (1 - p.meshSmoothnessRatio) * 100;
  const reductionNorm = clamp(rawReductionPct / 40, 0, 1);
  const smoothNorm = clamp(p.smoothParam / 2.5, 0, 1);
  const seamlessFrac = 0.5 * reductionNorm + 0.5 * smoothNorm;
  const penalty = (p.layered ? Math.min(30, p.layerCount * 6) : 0) + (p.webStrength > 0.05 ? Math.round(p.webStrength * 20) : 0);
  const quantScore = seamlessFrac * 100 - penalty;
  const quantitative = result(
    quantScore,
    `Smoothing removed ~${rawReductionPct.toFixed(0)}% of the blocky voxel surface (smooth=${p.smoothParam.toFixed(2)}); ` +
      `${p.layered ? `${p.layerCount} resistant layer(s)` : "no strata"} keep it reading ${quantScore >= 55 ? "seamless" : "paneled"}.`,
  );

  return { qualitative, quantitative };
}

// ------------------------------------------------------------ Stepped/Terraced
function scoreStepped(p: TilePrimitives): DescriptorScore {
  const levels = p.floorLevels.length;
  const quantScore = normalize(levels, 0, 6);
  const quantitative = result(quantScore, `${levels} distinct floor level(s) detected in section (rough-foam noise filtered out).`);

  const avgArea = levels > 0 ? p.floorLevels.reduce((a, l) => a + l.areaFt2, 0) / levels : 0;
  const areaFactor = normalize(avgArea, 10, 80);
  let evenness = 1;
  if (levels >= 2) {
    const gaps = p.floorLevels.slice(1).map((l, i) => l.zFt - p.floorLevels[i].zFt);
    evenness = clamp(1 - coefficientOfVariation(gaps), 0, 1);
  }
  const qualScore = levels === 0 ? 0 : levels === 1 ? areaFactor * 0.6 : 0.5 * areaFactor + 0.5 * evenness * 100;
  const qualitative = result(
    qualScore,
    levels === 0
      ? "No distinct setback platforms — section reads as one continuous slope, not steps."
      : `${levels} step(s) averaging ${ft2(avgArea)} each${levels >= 2 ? `, ${evenness >= 0.6 ? "fairly evenly" : "unevenly"} spaced` : ""}.`,
  );

  return { qualitative, quantitative };
}

// ---------------------------------------------------------------- Porous
function scorePorous(p: TilePrimitives): DescriptorScore {
  const quantScore = clamp(p.porosityPct, 0, 100);
  const quantitative = result(
    quantScore,
    `Openings make up ${pct(p.porosityPct)} of the void's own surface — the rest is solid void-facing wall.`,
  );

  const reachedScore = normalize(p.facesReached.length, 0, 6);
  const branchScore = normalize(p.totalBranches, 0, 10);
  const qualScore = 0.4 * reachedScore + 0.3 * branchScore + 0.3 * quantScore;
  const qualitative = result(
    qualScore,
    `${p.facesReached.length} of 6 faces have a real opening (≥${OPENING_THRESHOLD_FT2} ft²), ${p.totalBranches} distinct opening(s) total — ` +
      (qualScore >= 60 ? "reads as visually permeable across levels." : "mostly reads as closed."),
  );

  return { qualitative, quantitative };
}

// ------------------------------------------------------------- Continuous
function scoreContinuous(p: TilePrimitives): DescriptorScore {
  const seamProxyCount = (p.layered ? p.layerCount : 0) + (p.webStrength > 0.05 ? Math.round(2 + p.webStrength * 3) : 0);
  // "per 10m of surface" is read here as per 10 m^2 of the void's own mesh area, since
  // no linear seam length is available — stated plainly in the sentence below.
  const quantScore = 100 - clamp(seamProxyCount * 12, 0, 100);
  const quantitative = result(
    quantScore,
    `${seamProxyCount} generative seam source(s) (resistant strata / membrane webs) in the recipe, the source of any visible joints.`,
  );

  const qualScore = seamProxyCount === 0 ? 92 : clamp(100 - (p.layered ? 35 : 0) - (p.webStrength > 0.05 ? Math.round(p.webStrength * 40) : 0), 0, 100);
  const qualitative = result(
    qualScore,
    p.layered || p.webStrength > 0.05
      ? `The recipe intentionally introduces ${p.layered ? `${p.layerCount} layer(s)` : "membrane webs"} — some perceptible joints expected.`
      : "No intentional strata or webs in the recipe — surface should read as one continuous mass.",
  );

  return { qualitative, quantitative };
}

// -------------------------------------------------------- Retained/Resistant
function scoreResistant(p: TilePrimitives): DescriptorScore {
  const quantScore = clamp(p.retainedFractionPct, 0, 100);
  const quantitative = result(quantScore, `Retained solid mass is ${pct(p.retainedFractionPct)} of the tile's volume.`);

  const pieceFactor = p.voidPieces === 1 ? 100 : p.voidPieces <= 3 ? 60 : 30;
  const layerBonus = p.layered && p.layerStrength > 0.2 ? 20 : 0;
  const qualScore = 0.45 * quantScore + 0.35 * pieceFactor + layerBonus;
  const qualitative = result(
    qualScore,
    `${p.voidPieces} void piece(s) leave ${pct(p.retainedFractionPct)} solid standing` +
      (layerBonus ? " around an explicit resistant layer" : "") +
      ` — ${qualScore >= 60 ? "reads as one element resisting the erosion." : "resisting mass is hard to isolate."}`,
  );

  return { qualitative, quantitative };
}

// --------------------------------------------------------------- Threaded
function scoreThreaded(p: TilePrimitives): DescriptorScore {
  const instancesAboveGround = Math.max(p.floorLevels.length - 1, 0);
  const quantScore = normalize(instancesAboveGround, 0, 4);
  const quantitative = result(
    quantScore,
    `${instancesAboveGround} floor level(s) sit above the base level.`,
  );

  const qualScore = p.voidPieces === 1 ? 60 + instancesAboveGround * 10 : 30 - (p.voidPieces - 1) * 5;
  const qualitative = result(
    qualScore,
    p.voidPieces === 1
      ? "The void is one connected piece, so upper levels stay reachable from the ground route."
      : `The void splits into ${p.voidPieces} pieces — some levels are only reachable separately, not threaded through.`,
  );

  return { qualitative, quantitative };
}

// -------------------------------------------------------------- Graduated
function scoreGraduated(p: TilePrimitives): DescriptorScore {
  const steps = countPlateaus(p.verticalProfileFt2, 0.25);
  const quantScore = normalize(steps, 1, 6);
  const quantitative = result(quantScore, `${steps} distinct enclosure "step(s)" from base to top in the vertical cross-section profile.`);

  const abrupt = averageRelativeJump(p.verticalProfileFt2);
  const qualScore = 100 * (1 - clamp(abrupt * 1.5, 0, 1));
  const qualitative = result(
    qualScore,
    `Cross-section changes by an average of ${pct(abrupt * 100)} between adjacent slices — ` +
      (qualScore >= 60 ? "a smooth enclosed-to-open transition." : "an abrupt jump between zones."),
  );

  return { qualitative, quantitative };
}

// ----------------------------------------------------- Non-hierarchical Circulation
function scoreNonHierarchical(p: TilePrimitives): DescriptorScore {
  // Each distinct branch (lib/faceBranches.ts) is a physically separate
  // opening a person could actually pass through — a far more direct proxy
  // for "how many routes exist" than counting which faces are reached at
  // all, since one face can carry several separate openings (or, just as
  // real, a smaller opening that doesn't push its whole face over the
  // "reached" threshold).
  const routesProxy = p.voidPieces === 1 ? Math.max(p.totalBranches - 1, 0) : 0;
  const quantScore = normalize(routesProxy, 0, 8);
  const quantitative = result(
    quantScore,
    `${p.totalBranches} distinct opening(s) across ${p.facesReached.length} face(s) on a single connected void → about ${routesProxy} alternate route(s) between them.`,
  );

  const cv = coefficientOfVariation(p.branchAreasFt2);
  const qualScore = p.branchAreasFt2.length < 2 ? 0 : 100 * (1 - clamp(cv, 0, 1));
  const qualitative = result(
    qualScore,
    p.branchAreasFt2.length < 2
      ? "Fewer than two distinct openings — not enough routes to compare weight."
      : `${p.branchAreasFt2.length} distinct openings vary ${cv < 0.3 ? "little" : "a lot"} in size (spread ${cv.toFixed(2)}) — paths ` +
        (qualScore >= 60 ? "feel similarly weighted." : "look like one route clearly dominates."),
  );

  return { qualitative, quantitative };
}

// -------------------------------------------------------------- Force-driven
function scoreForceDriven(p: TilePrimitives): DescriptorScore {
  const concScore = p.doseConcentration * 100;
  const gravBonus = p.gravity > 0.05 ? 15 : 0;
  const quantScore = concScore * 0.85 + gravBonus;
  const quantitative = result(
    quantScore,
    `Largest source ("${p.dominantMode}") carries ${pct(p.doseConcentration * 100)} of ${p.totalDoseFt3.toFixed(0)} ft³ total dose` +
      (p.gravity > 0.05 ? `, with gravity ${p.gravity.toFixed(2)} pulling it downward` : "") +
      " — a directly measurable generating input, read from the recipe.",
  );

  const outcomeFactor = p.voidPieces === 1 ? normalize(p.facesReached.length, 1, 5) : 30;
  const qualScore = 0.5 * quantScore + 0.5 * outcomeFactor;
  const qualitative = result(
    qualScore,
    `${p.sources.length} source(s) drove this erosion — the final form ${qualScore >= 60 ? "clearly" : "loosely"} traces back to that input.`,
  );

  return { qualitative, quantitative };
}

// -------------------------------------------------------------- Light-filled
function scoreLightFilled(p: TilePrimitives): DescriptorScore {
  const baseFloorAreaFt2 = p.floorLevels.length > 0 ? p.floorLevels[0].areaFt2 : 0;
  const quantScore = clamp(p.skylightPct, 0, 100);
  const quantitative = result(
    quantScore,
    baseFloorAreaFt2 > 0
      ? `Skylight opening is ${pct(p.skylightPct)} of the ${ft2(baseFloorAreaFt2)} floor area below it.`
      : "No clear base floor plate to measure a skylight ratio against.",
  );

  const reachesTop = p.faceOpenAreaFt2["+Z"] >= OPENING_THRESHOLD_FT2;
  const qualScore = 0.7 * normalize(p.skylightPct, 0, 80) + 0.3 * (reachesTop ? 100 : 20);
  const qualitative = result(
    qualScore,
    `${reachesTop ? "A real" : "Little to no"} overhead opening (${ft2(p.faceOpenAreaFt2["+Z"])} on +Z) above the void's base — ` +
      (qualScore >= 60 ? "should read as bright at the base." : "the base likely reads dim."),
  );

  return { qualitative, quantitative };
}

// ---------------------------------------------------------------- Monumental
function scoreMonumental(p: TilePrimitives): DescriptorScore {
  const hwNorm = normalize(p.heightToWidthRatio, 0.3, 2.2);
  const volNorm = clamp(p.voidFractionPct, 0, 100);
  const quantScore = 0.5 * hwNorm + 0.5 * volNorm;
  const quantitative = result(
    quantScore,
    `Height-to-width ratio ${p.heightToWidthRatio.toFixed(2)}, void at ${pct(p.voidFractionPct)} of the tile's volume.`,
  );

  const dominant = Math.max(hwNorm, volNorm);
  const minor = Math.min(hwNorm, volNorm);
  const qualScore = dominant * 0.8 + minor * 0.2;
  const qualitative = result(
    qualScore,
    `${hwNorm >= volNorm ? "Verticality" : "Sheer volume"} drives the scale impression here — ` +
      (qualScore >= 60 ? "reads as monumental within the 20 ft cube." : "reads as a modest-scale space."),
  );

  return { qualitative, quantitative };
}

// -------------------------------------------------- Spatial Density (compress/release)
function scoreSpatialDensity(p: TilePrimitives): DescriptorScore {
  const quantScore = 100 * (1 - p.compressionRatio);
  const quantitative = result(
    quantScore,
    `Along ${p.sequenceAxis.toUpperCase()}, cross-section narrows to ${ft2(p.narrowestFt2)} from a ${ft2(p.widestFt2)} wide moment ` +
      `(ratio ${p.compressionRatio.toFixed(2)}).`,
  );

  const nz = p.sequenceProfileFt2.filter((v) => v > 0);
  const nearNarrow = nz.filter((v) => v <= p.narrowestFt2 * 1.25).length / Math.max(nz.length, 1);
  const nearWide = nz.filter((v) => v >= p.widestFt2 * 0.75).length / Math.max(nz.length, 1);
  const presence = Math.min(nearNarrow, nearWide);
  const qualScore = 0.7 * quantScore + 0.3 * presence * 100;
  const qualitative = result(
    qualScore,
    `Both a tight (~${ft2(p.narrowestFt2)}) and open (~${ft2(p.widestFt2)}) moment persist along the sequence, not just a single spike — ` +
      (qualScore >= 60 ? "a strong compress-then-release effect." : "a mild one."),
  );

  return { qualitative, quantitative };
}

export function scoreTile(tile: ParsedTile): ScoredDescriptors {
  const p = computePrimitives(tile);
  return {
    carved: scoreCarved(p),
    stepped: scoreStepped(p),
    porous: scorePorous(p),
    continuous: scoreContinuous(p),
    resistant: scoreResistant(p),
    threaded: scoreThreaded(p),
    graduated: scoreGraduated(p),
    non_hierarchical: scoreNonHierarchical(p),
    force_driven: scoreForceDriven(p),
    light_filled: scoreLightFilled(p),
    monumental: scoreMonumental(p),
    spatial_density: scoreSpatialDensity(p),
  };
}
