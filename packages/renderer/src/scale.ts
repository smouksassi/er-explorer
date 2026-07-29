import type { Scale } from "./types";

/**
 * Ported verbatim from `packages/visualization-engine`'s `scaleLinear` - same behavior
 * (including the `|| 1` guard against a zero-width domain), just relocated so it has zero
 * dependency on anything statistics-related.
 */
export function scaleLinear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const m = (r1 - r0) / (d1 - d0 || 1);
  const scale = ((value: number) => r0 + (value - d0) * m) as Scale;
  scale.invert = (pixel: number) => d0 + (pixel - r0) / m;
  (scale as { domain: [number, number] }).domain = domain;
  (scale as { range: [number, number] }).range = range;
  return scale;
}
