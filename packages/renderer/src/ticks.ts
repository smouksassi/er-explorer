/**
 * Evenly-spaced tick positions across a domain, inclusive of both endpoints - shared by
 * `AxisLayer` and `GridLayer` so tick math lives in exactly one place. `count` is the number of
 * ticks produced (matches `renderLogisticScatterChart`'s y-axis `niceYTicks`, not its x-axis
 * loop, which produced `count + 1` ticks for `count` divisions - callers wanting that behavior
 * should pass `divisions + 1`).
 */
export function tickPositions(domain: [number, number], count: number): number[] {
  const [lo, hi] = domain;
  if (count <= 1) return [(lo + hi) / 2];
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/** Ported verbatim from the current renderer's default tick-label formatting. */
export function formatTickValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}
