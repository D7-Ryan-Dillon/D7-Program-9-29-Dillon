// Small, generic numeric helpers shared by the descriptor scorers. Nothing
// here knows about tiles or descriptors — see primitives.ts and engine.ts.

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Linear map of v from [lo, hi] to [0, 100], clamped at both ends. */
export function normalize(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  if (hi === lo) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
}

/** Triangular response: 0 at/beyond lo and hi, 100 at peak. Used where a
 * descriptor reads best in a mid-range (e.g. Carved: too little void hasn't
 * carved anything, too much reads as a lattice rather than a mass). */
export function triangular(v: number, lo: number, peak: number, hi: number): number {
  if (v <= lo || v >= hi) return 0;
  if (v <= peak) return ((v - lo) / (peak - lo)) * 100;
  return ((hi - v) / (hi - peak)) * 100;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Clusters a 1D array of per-slice areas (e.g. floor area at every Z layer)
 * into runs of "present" slices, tolerating small gaps (the rough foam
 * surface can drop a slice below threshold for a cell or two without that
 * being a real second level). Returns one entry per cluster: its
 * area-weighted index and total area. */
export function clusterLevels(
  values: number[],
  minValue: number,
  gapTolerance = 2,
): { index: number; area: number }[] {
  const levels: { index: number; area: number }[] = [];
  let i = 0;
  const n = values.length;
  while (i < n) {
    if (values[i] < minValue) {
      i++;
      continue;
    }
    let j = i;
    let sumArea = 0;
    let sumWeighted = 0;
    let gap = 0;
    while (j < n) {
      if (values[j] >= minValue) {
        sumArea += values[j];
        sumWeighted += values[j] * j;
        gap = 0;
        j++;
      } else {
        gap++;
        if (gap > gapTolerance) break;
        j++;
      }
    }
    levels.push({ index: sumArea > 0 ? sumWeighted / sumArea : i, area: sumArea });
    i = j;
  }
  return levels;
}

/** Counts distinct plateaus in a profile (values close to their running
 * neighbour average are the same plateau; a bigger relative jump starts a
 * new one). Zero entries are dropped first since they mean "no void at that
 * slice" rather than "a very narrow moment". */
export function countPlateaus(values: number[], relTolerance = 0.2): number {
  const nz = values.filter((v) => v > 0);
  if (nz.length === 0) return 0;
  let clusters = 1;
  let ref = nz[0];
  let runLen = 1;
  for (let k = 1; k < nz.length; k++) {
    const v = nz[k];
    if (Math.abs(v - ref) / Math.max(ref, 1e-6) <= relTolerance) {
      runLen++;
      ref = (ref * (runLen - 1) + v) / runLen;
    } else {
      clusters++;
      ref = v;
      runLen = 1;
    }
  }
  return clusters;
}

/** Average relative jump between consecutive non-zero entries — a rough
 * "how abrupt is this profile" measure. 0 = perfectly smooth. */
export function averageRelativeJump(values: number[]): number {
  const nz = values.filter((v) => v > 0);
  if (nz.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < nz.length; i++) {
    const a = nz[i - 1];
    const b = nz[i];
    sum += Math.abs(b - a) / Math.max(a, b, 1e-6);
  }
  return sum / (nz.length - 1);
}

/** Coefficient of variation (stdev / mean), 0 when every value is equal. */
export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 1e-9) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
