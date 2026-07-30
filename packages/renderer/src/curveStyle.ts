/**
 * Pluggable curve interpolation for `Fit`/`ConfidenceRibbon`, mirroring the shape-strategy
 * pattern `Distribution` uses for Boxplot/Violin/Lineranges (docs/RENDERER_ARCHITECTURE.md
 * section 3, and the Kaplan-Meier worked example in section 7): the two layers share real
 * machinery (pixel-projection, band-closing), but "how do I connect these points" genuinely
 * differs between a smooth exposure-response fit and a step-function survival curve, which is
 * exactly the kind of fact a named, separately-exported strategy expresses cleanly.
 */
export interface CurveStyle {
  readonly id: string;
  /** Builds an SVG path 'd' string through pixel-space points, already sorted ascending by x. */
  buildPath(points: Array<{ x: number; y: number }>): string;
}

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function buildStepPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  const parts = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    // Hold the previous y until the new x, then jump - the "step-after" convention Kaplan-Meier
    // survival curves use.
    parts.push(`L${curr.x.toFixed(2)},${prev.y.toFixed(2)}`);
    parts.push(`L${curr.x.toFixed(2)},${curr.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

/** Linear interpolation between points - the default, and the only style the current
 * (pre-redesign) renderer supports. */
export const SmoothStyle: CurveStyle = { id: "smooth", buildPath: buildSmoothPath };

/** Step-after interpolation - not used by any current call site; added now so `Fit`/
 * `ConfidenceRibbon` don't need a breaking change whenever a step-function endpoint type
 * (Kaplan-Meier/Cox) actually arrives (docs/RENDERER_ARCHITECTURE.md section 7). */
export const StepStyle: CurveStyle = { id: "step", buildPath: buildStepPath };

/** Builds a closed ribbon path from parallel upper/lower pixel-space point arrays, both
 * interpolated with the same `CurveStyle` the paired `Fit` layer uses, so a step-styled curve
 * gets a step-styled band rather than one that visually disagrees with its own line. */
export function buildBandPath(
  upper: Array<{ x: number; y: number }>,
  lower: Array<{ x: number; y: number }>,
  style: CurveStyle = SmoothStyle
): string {
  if (!upper.length || !lower.length) return "";
  const upperPath = style.buildPath(upper);
  const lowerPath = style.buildPath([...lower].reverse());
  return `${upperPath} ${lowerPath.replace(/^M/, "L")} Z`;
}
