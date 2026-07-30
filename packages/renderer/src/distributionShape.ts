import { SmoothStyle } from "./curveStyle";
import type { Scale } from "./types";

/**
 * Builds a closed ridge polygon path from independent per-sample top and bottom pixel offsets
 * (each measured away from `cy`) - ported from the current renderer's `buildAsymRidgePath`. A
 * mirrored violin is just the special case where `topPx === bottomPx` (see `buildRidgePath`
 * below); a one-sided ("half violin") distribution instead pins `bottomPx` to a flat baseline
 * while `topPx` traces a density curve, so only the upper half of what would otherwise be a
 * mirrored blob is drawn.
 *
 * Exported standalone (not just used internally by `DistributionLayer`) because `apps/demo`'s
 * own boxplot<->violin morph animation calls this directly, frame by frame, interpolating
 * `topPx`/`bottomPx` between the two modes' keyframes entirely outside any Layer's `render()` -
 * the same reason `interpolateCurveSample` is exported rather than kept private to `Fit`.
 */
export function buildAsymRidgePath(xSamples: number[], topPx: number[], bottomPx: number[], xScale: Scale, cy: number): string {
  const top = xSamples.map((xv, i) => ({ x: xScale(xv), y: cy - topPx[i] }));
  const bottom = xSamples.map((xv, i) => ({ x: xScale(xv), y: cy + bottomPx[i] })).reverse();
  const topPath = SmoothStyle.buildPath(top);
  const bottomPath = SmoothStyle.buildPath(bottom).replace(/^M/, "L");
  if (!topPath || !bottomPath) return "";
  return `${topPath} ${bottomPath} Z`;
}

/** Build a closed, mirrored ridge/violin polygon path from per-sample half-heights (pixels). */
export function buildRidgePath(xSamples: number[], halfHeightsPx: number[], xScale: Scale, cy: number): string {
  return buildAsymRidgePath(xSamples, halfHeightsPx, halfHeightsPx, xScale, cy);
}
