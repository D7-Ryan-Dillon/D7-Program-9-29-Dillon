// Tiny seeded PRNG (mulberry32) so the seed slider gives reproducible
// auto-generate results — same seed, same layout, every time, matching how
// the erosion engine itself relies on a seed for reproducibility.

export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickRandom<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}
