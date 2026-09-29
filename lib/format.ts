export function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function fmtFt2(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${fmtNum(n, 1)} ft²`;
}

export function fmtFt3(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${fmtNum(n, 1)} ft³`;
}

export function fmtFt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${fmtNum(n, 2)} ft`;
}

export function fmtPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function fmtVec3(v: [number, number, number] | null | undefined, decimals = 1): string {
  if (!v) return "—";
  return `(${v.map((x) => fmtNum(x, decimals)).join(", ")})`;
}
