/** Deterministic PRNG (mulberry32) so bootstrap results are reproducible from a session's stored seed (see `@er-explorer/domain`'s `BootstrapConfig` and `docs/REPRODUCIBILITY.md`). */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated percentile of a pre-sorted (ascending) array. */
export function quantile(sortedAscending: number[], p: number): number {
  const n = sortedAscending.length;
  if (!n) return NaN;
  const i = (n - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sortedAscending[lo];
  return sortedAscending[lo] + (sortedAscending[hi] - sortedAscending[lo]) * (i - lo);
}
