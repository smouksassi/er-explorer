import type { ModelDefinition, PredictionResult, DistributionSummary } from "@er-explorer/statistical-engine";
import { summarizeDistribution, kernelDensityEstimate, silvermanBandwidth } from "@er-explorer/statistical-engine";

export type RenderTarget = "svg" | "canvas";

export interface ChartOptions {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  renderTarget: RenderTarget;
  responsive?: boolean;
}

export interface VisualizationSpec {
  id: string;
  model: ModelDefinition;
  data: PredictionResult;
  options: ChartOptions;
}

export interface RenderResult {
  outputType: RenderTarget;
  content: string;
  metadata: Record<string, unknown>;
}

export const createVisualizationSpec = (id: string, model: ModelDefinition, data: PredictionResult, options: ChartOptions): VisualizationSpec => ({
  id,
  model,
  data,
  options
});

export const createRenderResult = (outputType: RenderTarget, content: string): RenderResult => ({
  outputType,
  content,
  metadata: {}
});

/** Deterministic pseudo-jitter (by index) so repeated renders of the same dataset are pixel-stable. */
export function seededJitter(index: number, amplitude = 0.09): number {
  const s = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2 * amplitude;
}

/* ---------------------------------------------------------------------- *
 * Geometry primitives
 *
 * ADR-0002 keeps statistics and visualization separate: everything here
 * consumes plain numbers/PredictionResult-shaped data, never model
 * internals. ADR-0003 makes SVG the primary render target, so every chart
 * renders to a self-contained, publication-quality SVG markup string that
 * can be dropped straight into a document as well as into a browser.
 * ---------------------------------------------------------------------- */

export interface Scale {
  (value: number): number;
  invert(pixel: number): number;
  domain: [number, number];
  range: [number, number];
}

export function scaleLinear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const m = (r1 - r0) / (d1 - d0 || 1);
  const scale = ((value: number) => r0 + (value - d0) * m) as Scale;
  scale.invert = (pixel: number) => d0 + (pixel - r0) / m;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const tag = (name: string, attrs: Record<string, string | number | undefined>, children = ""): string => {
  const attrString = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${esc(v as string | number)}"`)
    .join(" ");
  return `<${name} ${attrString}>${children}</${name}>`;
};

const selfClosing = (name: string, attrs: Record<string, string | number | undefined>): string => {
  const attrString = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${esc(v as string | number)}"`)
    .join(" ");
  return `<${name} ${attrString}/>`;
};

/** Build an SVG path 'd' string through a set of (x,y) points already in pixel space. */
export function buildLinePath(points: Array<[number, number]>): string {
  if (!points.length) return "";
  return points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
}

/** Build a closed ribbon path from parallel upper/lower pixel-space point arrays (e.g. a CI band). */
export function buildBandPath(upper: Array<[number, number]>, lower: Array<[number, number]>): string {
  if (!upper.length || !lower.length) return "";
  const pts = upper.concat(lower.slice().reverse());
  return buildLinePath(pts) + " Z";
}

/** Convenience: map a dense PredictionResult (sorted by exposure) to a pixel-space line path. */
export function curvePathFromEstimates(estimates: PredictionResult["estimates"], xScale: Scale, yScale: Scale): string {
  const pts = estimates.map((e) => [xScale(e.exposure), yScale(e.estimate)] as [number, number]);
  return buildLinePath(pts);
}

/** Convenience: map a dense PredictionResult with lower/upper (sorted by exposure) to a pixel-space band path. */
export function bandPathFromEstimates(estimates: PredictionResult["estimates"], xScale: Scale, yScale: Scale): string | null {
  if (estimates.some((e) => !isFinite(e.lower) || !isFinite(e.upper))) return null;
  const upper = estimates.map((e) => [xScale(e.exposure), yScale(e.upper)] as [number, number]);
  const lower = estimates.map((e) => [xScale(e.exposure), yScale(e.lower)] as [number, number]);
  return buildBandPath(upper, lower);
}

/* ---------------------------------------------------------------------- *
 * Logistic exposure-response scatter + fit chart
 * ---------------------------------------------------------------------- */

export interface ScatterPoint {
  id: string | number;
  exposure: number;
  response: number;
  displayY?: number;
  groupId: string | number;
  label?: string;
  selected?: boolean;
}

export interface ProjectedGroup {
  groupId: string | number;
  color: string;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  /** This group's actual minimum and maximum observed exposure - optional, since older callers
   * (or a group with only one distinct value) may not have both. When present, small hollow
   * markers are drawn at the curve's value at min/max, in addition to the Q1/median/Q3 dots, so
   * clicking a dose row shows the full observed range it was projected over, not just the IQR. */
  min?: number;
  max?: number;
  /** This dose group's own observed (non-model) response rate + 95% CI, drawn in the group's
   * own color next to its projected curve segment - lets "highlight this dose" answer both
   * "where does it sit on the fitted curve" and "what was its actual observed rate" at once. */
  observed?: {
    proportion: number;
    ciLower: number;
    ciUpper: number;
    n: number;
    responders: number;
  };
}

/** A vertical reference line drawn at a fixed exposure value (e.g. a global median/tertile/quartile),
 * spanning the full plot height, with a small label at the top. */
export interface ReferenceLine {
  value: number;
  label: string;
}

function renderReferenceLines(
  referenceLines: ReferenceLine[] | undefined,
  xDomain: [number, number],
  x: Scale,
  plot: { top: number; height: number },
  showValueAtBottom = false
): string {
  if (!referenceLines?.length) return "";
  const visible = referenceLines.filter((ref) => ref.value >= xDomain[0] && ref.value <= xDomain[1]).sort((a, b) => a.value - b.value);
  if (!visible.length) return "";

  let out = "";
  // stagger label rows so a wide label doesn't run into the next line's label - track each
  // row's current right edge (estimated from character count) and place each label in
  // whichever of the two rows it clears
  const rowRightEdge = [-Infinity, -Infinity];
  let row = 0;
  // same idea for the bottom value labels, but center-anchored so track by half-width instead
  const bottomRowRightEdge = [-Infinity, -Infinity];
  let bottomRow = 0;
  visible.forEach((ref) => {
    const xx = x(ref.value);
    out += selfClosing("line", {
      x1: xx,
      y1: plot.top,
      x2: xx,
      y2: plot.top + plot.height,
      stroke: "#0f172a",
      "stroke-width": 1.4,
      "stroke-dasharray": "3 3",
      opacity: 0.55
    });
    if (xx < rowRightEdge[row]) row = 1 - row;
    out += tag(
      "text",
      { x: xx + 4, y: plot.top + 11 + row * 12, "text-anchor": "start", fill: "#0f172a", "font-size": 10.5, "font-weight": 700, opacity: 0.75 },
      esc(ref.label)
    );
    rowRightEdge[row] = xx + 4 + ref.label.length * 6.3;

    if (showValueAtBottom) {
      // the actual cut-point value (e.g. "63.1"), so the user can read off exactly what "T1
      // (33%)" means in the plot's own units. Styled in the same lighter grey as the scatter
      // panel's reference-line fit marker above (#94a3b8) - both show "the value at this split
      // line", so they're deliberately color-matched, and both deliberately differ from the
      // (near-black) observed-rate markers and the muted x-axis tick grey, so none of the three
      // reads as "just another tick".
      const valueText = ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1);
      const halfWidth = (valueText.length * 6.4) / 2 + 3;
      if (xx - halfWidth < bottomRowRightEdge[bottomRow]) bottomRow = 1 - bottomRow;
      out += tag(
        "text",
        { x: xx, y: plot.top + plot.height - 6 - bottomRow * 13, "text-anchor": "middle", fill: "#94a3b8", "font-size": 10.5, "font-weight": 700, opacity: 0.9 },
        esc(valueText)
      );
      bottomRowRightEdge[bottomRow] = xx + halfWidth;
    }
  });
  return tag("g", { class: "er-reference-lines" }, out);
}

/** One observed-response marker: the raw (non-model) responder rate within a bin of the active
 * exposure split, with a 95% CI, plotted against the fitted curve so the two can be compared
 * directly (mirrors ggquickeda's "Observed probability by exposure split" annotation). */
export interface ObservedResponseBin {
  /** domain-space x position for the marker (typically the bin's mean exposure) */
  x: number;
  proportion: number;
  ciLower: number;
  ciUpper: number;
  n: number;
  responders: number;
  /** Override the marker's default dark/neutral color - used when comparing multiple curves
   * (e.g. one per endpoint) in the same chart, where each curve's own markers should match it. */
  color?: string;
}

/** One curve-adjacent marker waiting to be laid out: a pixel x position, the y-domain value/CI
 * bounds to plot (a proportion for observed-rate markers, a fitted probability for reference-line
 * fit markers - anything on the same [0,1] y-axis), the color to render it in, and its two label
 * lines (already formatted as strings, since different marker kinds show different content - an
 * observed marker shows "pct%" / "n/N", a reference-line marker shows the exposure value / "fit
 * x.xx [lo-hi]" - but both are laid out and drawn identically). */
interface PositionedMarker {
  xx: number;
  color: string;
  yValue: number;
  yLowValue: number;
  yHighValue: number;
  line1: string;
  line2: string;
}

interface LaidOutMarker extends PositionedMarker {
  yMid: number;
  yLo: number;
  yHi: number;
  labelTop: number;
}

const OBSERVED_LABEL_HEIGHT = 30;
const OBSERVED_LABEL_GAP = 5;
const OBSERVED_CLUSTER_GAP_PX = 80;

/**
 * Lays out curve-adjacent marker labels so nearby ones never overlap. Observed-rate markers
 * (split-bin and per-dose alike) and reference-line fit markers are laid out together (they
 * compete for the same space), since a selected dose's own median exposure often falls right
 * next to a split cut point. Markers whose pixel-x positions are close together are grouped into
 * a cluster and stacked into a vertical column - the one with the highest natural position
 * anchors the stack, and the rest are placed directly above it - each keeping a thin leader line
 * back down to its true point. This is a small, dependency-free stand-in for a proper force/repel
 * layout (no D3, consistent with the rest of this renderer).
 */
function layoutMarkers(markers: PositionedMarker[], y: Scale, plotTop: number, plotBottom: number): LaidOutMarker[] {
  const withY = markers.map((m) => ({
    ...m,
    yMid: y(m.yValue),
    yLo: y(m.yLowValue),
    yHi: y(m.yHighValue)
  }));
  const sorted = [...withY].sort((a, b) => a.xx - b.xx);
  const clusters: (typeof withY)[] = [];
  for (const m of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && m.xx - last[last.length - 1].xx < OBSERVED_CLUSTER_GAP_PX) last.push(m);
    else clusters.push([m]);
  }

  const minTop = plotTop + 2;
  const maxBottom = plotBottom - 2;
  const available = maxBottom - minTop;
  const placed: LaidOutMarker[] = [];
  clusters.forEach((cluster) => {
    const withNatural = cluster.map((m) => ({ ...m, natural: m.yHi - 34 })).sort((a, b) => a.natural - b.natural);
    const n = withNatural.length;
    const requiredSpan = n * OBSERVED_LABEL_HEIGHT + (n - 1) * OBSERVED_LABEL_GAP;

    if (requiredSpan > available) {
      // more markers are crowded into this x-region than can fit at full size while both staying
      // on-canvas and keeping their natural stacking order - rather than let some run off the top
      // or bottom edge, spread them evenly across the whole available vertical range instead (a
      // graceful compression fallback for dense cases, e.g. overlaying several endpoints' split
      // bins on the same exposure axis at once, which multiplies how many markers land near the
      // same x position)
      const step = n > 1 ? (available - OBSERVED_LABEL_HEIGHT) / (n - 1) : 0;
      withNatural.forEach((m, i) => {
        placed.push({ ...m, labelTop: minTop + i * step });
      });
      return;
    }

    const tops: number[] = [];
    let nextTop = Infinity;
    withNatural.forEach((m, i) => {
      const top = i === 0 ? m.natural : Math.min(m.natural, nextTop - OBSERVED_LABEL_HEIGHT - OBSERVED_LABEL_GAP);
      nextTop = top;
      tops.push(top);
    });
    // a tall stack (many markers crowded into one x-region) can run out of room above or below
    // the plot - rather than let it float off-canvas, shift the whole stack just enough to clear
    // whichever edge it overflows, keeping every label's spacing intact relative to the others
    const topOverflow = minTop - Math.min(...tops);
    const bottomOverflow = Math.max(...tops) + OBSERVED_LABEL_HEIGHT - maxBottom;
    const shift = topOverflow > 0 ? topOverflow : bottomOverflow > 0 ? -bottomOverflow : 0;
    withNatural.forEach((m, i) => {
      placed.push({ ...m, labelTop: tops[i] + shift });
    });
  });
  return placed;
}

/** Renders one already-laid-out curve-adjacent marker: dot + CI error bar + its two label lines
 * (both colored to match, for easy visual matching to a dose/curve), with a white halo/backdrop
 * so it stays legible over dense scatter points, and a leader line back to its true point
 * whenever the label had to be relocated to avoid a neighbor. */
function renderMarker(m: LaidOutMarker): string {
  const { xx, yMid, yLo, yHi, labelTop, color, line1, line2 } = m;
  const labelBoxWidth = Math.max(line1.length, line2.length) * 7 + 10;
  const labelBottom = labelTop + OBSERVED_LABEL_HEIGHT;

  let out = "";
  if (labelBottom < yHi - 2) {
    out += selfClosing("line", { x1: xx, y1: yHi, x2: xx, y2: labelBottom, stroke: color, "stroke-width": 1, "stroke-dasharray": "2 2", opacity: 0.6 });
  }
  out += selfClosing("line", { x1: xx, y1: yLo - 7, x2: xx, y2: yHi + 7, stroke: "#ffffff", "stroke-width": 8, opacity: 0.9, "stroke-linecap": "round" });
  out += selfClosing("circle", { cx: xx, cy: yMid, r: 8, fill: "#ffffff", opacity: 0.92 });
  out += selfClosing("rect", { x: xx - labelBoxWidth / 2, y: labelTop, width: labelBoxWidth, height: OBSERVED_LABEL_HEIGHT, rx: 5, fill: "#ffffff", opacity: 0.94, stroke: color, "stroke-width": 1.2 });

  out += selfClosing("line", { x1: xx, y1: yLo, x2: xx, y2: yHi, stroke: color, "stroke-width": 1.8, opacity: 0.95 });
  out += selfClosing("line", { x1: xx - 4.5, y1: yLo, x2: xx + 4.5, y2: yLo, stroke: color, "stroke-width": 1.5, opacity: 0.95 });
  out += selfClosing("line", { x1: xx - 4.5, y1: yHi, x2: xx + 4.5, y2: yHi, stroke: color, "stroke-width": 1.5, opacity: 0.95 });
  out += selfClosing("circle", { cx: xx, cy: yMid, r: 4.6, fill: color, stroke: "#fff", "stroke-width": 1.4 });
  out += tag("text", { x: xx, y: labelTop + 14, "text-anchor": "middle", fill: color, "font-size": 12, "font-weight": 800 }, esc(line1));
  out += tag("text", { x: xx, y: labelTop + 26, "text-anchor": "middle", fill: color, "font-size": 10.5 }, esc(line2));
  return out;
}

function renderMarkers(markers: PositionedMarker[], y: Scale, plotTop: number, plotBottom: number): string {
  if (!markers.length) return "";
  const laidOut = layoutMarkers(markers, y, plotTop, plotBottom);
  return tag("g", { class: "er-observed-markers" }, laidOut.map(renderMarker).join(""));
}

/** An additional fitted curve (+ optional CI band) overlaid in the same chart, e.g. one other
 * endpoint's fit when comparing several endpoints on the same exposure axis. Rendered exactly
 * like the primary curve/band but in its own color and dash pattern. */
export interface ExtraCurve {
  curve: PredictionResult;
  band?: PredictionResult;
  color: string;
  dash?: string;
}

export interface LogisticScatterInput {
  points: ScatterPoint[];
  curve: PredictionResult;
  band?: PredictionResult;
  projected?: ProjectedGroup[];
  groupColors: Record<string, string>;
  xDomain: [number, number];
  yDomain?: [number, number];
  referenceLines?: ReferenceLine[];
  /** Observed (non-model) response rate + CI per exposure-split bin, drawn atop the fitted
   * curve for a direct visual comparison. Optional - omit to hide. */
  observedBins?: ObservedResponseBin[];
  /** When true (and referenceLines is non-empty), also mark each active reference line's fitted
   * probability + CI right on the curve, e.g. "83.8" / "fit 0.74 [0.70-0.78]". Off by default -
   * an opt-in overlay, same as observedBins, since it adds another marker competing for the same
   * space and isn't always wanted. */
  showReferenceFit?: boolean;
  /** Override the primary curve/band's default grey styling - used when this chart represents
   * one specific endpoint/series being compared against others, so its curve reads in that
   * series' own color rather than the neutral default. */
  curveColor?: string;
  curveDash?: string;
  bandColor?: string;
  /** Other curves (e.g. other endpoints) overlaid in the same axes as the primary curve, each in
   * its own color/dash - powers the "compare endpoints" overlay panel. */
  extraCurves?: ExtraCurve[];
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  options: ChartOptions;
}

// left margin matches renderDistributionChart's default exactly (96, sized for that chart's
// dose-name row labels like "1800 mg") so the two vertically-stacked panels' x=0 pixel position
// lines up - otherwise the scatter chart's narrower "0"/"1" y-axis labels would let its plot
// start further left than the distribution panel below it, visibly misaligning the shared x-axis.
const DEFAULT_MARGIN = { top: 22, right: 20, bottom: 56, left: 96 };

export function renderLogisticScatterChart(input: LogisticScatterInput): RenderResult {
  const width = input.width ?? 1200;
  const height = input.height ?? 420;
  const margin = input.margin ?? DEFAULT_MARGIN;
  const plot = { left: margin.left, top: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
  const yDomain = input.yDomain ?? [-0.18, 1.18];
  const x = scaleLinear(input.xDomain, [plot.left, plot.left + plot.width]);
  const y = scaleLinear(yDomain, [plot.top + plot.height, plot.top]);

  const parts: string[] = [];

  // grid
  const xTicks = 6;
  let grid = "";
  for (let i = 0; i <= xTicks; i++) {
    const xv = input.xDomain[0] + (input.xDomain[1] - input.xDomain[0]) * (i / xTicks);
    const xx = x(xv);
    grid += selfClosing("line", { x1: xx, y1: plot.top, x2: xx, y2: plot.top + plot.height, stroke: "#edf1f7" });
  }
  for (const v of [0, 1]) {
    const yy = y(v);
    grid += selfClosing("line", { x1: plot.left, y1: yy, x2: plot.left + plot.width, y2: yy, stroke: "#edf1f7" });
  }
  parts.push(tag("g", { class: "er-grid" }, grid));

  // CI band + fitted curve (colors/dash overridable so this chart can represent one specific
  // series - e.g. one endpoint among several being compared - rather than always neutral grey)
  const bandSource = input.band ?? input.curve;
  const bandPath = bandPathFromEstimates(bandSource.estimates, x, y);
  if (bandPath) {
    parts.push(selfClosing("path", { d: bandPath, fill: input.bandColor ?? "#94a3b8", opacity: 0.18, stroke: "none" }));
  }
  const curvePath = curvePathFromEstimates(input.curve.estimates, x, y);
  if (curvePath) {
    parts.push(
      selfClosing("path", {
        d: curvePath,
        fill: "none",
        stroke: input.curveColor ?? "#64748b",
        "stroke-width": 2,
        "stroke-dasharray": input.curveDash ?? "7 5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: 0.85
      })
    );
  }

  // additional overlaid curves (e.g. other endpoints), each in its own color/dash
  for (const extra of input.extraCurves ?? []) {
    const extraBandSource = extra.band ?? extra.curve;
    const extraBandPath = bandPathFromEstimates(extraBandSource.estimates, x, y);
    if (extraBandPath) parts.push(selfClosing("path", { d: extraBandPath, fill: extra.color, opacity: 0.14, stroke: "none" }));
    const extraCurvePath = curvePathFromEstimates(extra.curve.estimates, x, y);
    if (extraCurvePath) {
      parts.push(
        selfClosing("path", {
          d: extraCurvePath,
          fill: "none",
          stroke: extra.color,
          "stroke-width": 2,
          "stroke-dasharray": extra.dash ?? "7 5",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: 0.85
        })
      );
    }
  }

  // collected across all sources (split bins, per-dose projections, reference-line fit values)
  // so the layout pass can avoid overlap between them, not just within each source
  const observedMarkers: PositionedMarker[] = [];

  // projected group overlays (Q1-Q3 emphasized segment, min/max-span thin segment, markers)
  for (const p of input.projected ?? []) {
    const rangeLow = p.min ?? p.whiskerLow;
    const rangeHigh = p.max ?? p.whiskerHigh;
    const segRange = input.curve.estimates.filter((e) => e.exposure >= rangeLow && e.exposure <= rangeHigh);
    const segCore = input.curve.estimates.filter((e) => e.exposure >= p.q1 && e.exposure <= p.q3);
    const bandRange = (input.band ?? input.curve).estimates.filter((e) => e.exposure >= rangeLow && e.exposure <= rangeHigh);
    const segBand = bandPathFromEstimates(bandRange, x, y);
    if (segBand) parts.push(selfClosing("path", { d: segBand, fill: p.color, opacity: 0.1, stroke: "none" }));
    const segThin = curvePathFromEstimates(segRange, x, y);
    if (segThin) parts.push(selfClosing("path", { d: segThin, fill: "none", stroke: p.color, "stroke-width": 1.8, opacity: 0.48, "stroke-linecap": "round" }));
    const segThick = curvePathFromEstimates(segCore, x, y);
    if (segThick) parts.push(selfClosing("path", { d: segThick, fill: "none", stroke: p.color, "stroke-width": 3.8, opacity: 0.98, "stroke-linecap": "round" }));

    const at = (xv: number) => {
      const est = interpolateEstimate(input.curve.estimates, xv);
      return est;
    };
    const pQ1 = at(p.q1);
    const pQ3 = at(p.q3);
    const pMed = at(p.median);
    parts.push(selfClosing("rect", { x: x(p.q1), y: plot.top + 2, width: Math.max(1, x(p.q3) - x(p.q1)), height: plot.height - 4, fill: p.color, opacity: 0.06, rx: 8 }));
    parts.push(selfClosing("line", { x1: x(p.q1), y1: y(pQ1), x2: x(p.q1), y2: plot.top + plot.height, stroke: p.color, "stroke-width": 1.4, "stroke-dasharray": "4 4", opacity: 0.75 }));
    parts.push(selfClosing("line", { x1: x(p.q3), y1: y(pQ3), x2: x(p.q3), y2: plot.top + plot.height, stroke: p.color, "stroke-width": 1.4, "stroke-dasharray": "4 4", opacity: 0.75 }));
    parts.push(selfClosing("circle", { cx: x(p.q1), cy: y(pQ1), r: 4.6, fill: p.color, stroke: "#fff", "stroke-width": 1.2 }));
    parts.push(selfClosing("circle", { cx: x(p.q3), cy: y(pQ3), r: 4.6, fill: p.color, stroke: "#fff", "stroke-width": 1.2 }));
    parts.push(selfClosing("circle", { cx: x(p.median), cy: y(pMed), r: 4, fill: "#111827", stroke: "#fff", "stroke-width": 1.1 }));

    // min/max: small hollow markers (filled white, colored outline) so they read as "the observed
    // extremes" at a glance, distinct from the filled Q1/Q3 dots and the dark median dot.
    if (p.min !== undefined) {
      const pMin = at(p.min);
      parts.push(selfClosing("line", { x1: x(p.min), y1: y(pMin), x2: x(p.min), y2: plot.top + plot.height, stroke: p.color, "stroke-width": 1, "stroke-dasharray": "1.5 3", opacity: 0.55 }));
      parts.push(selfClosing("circle", { cx: x(p.min), cy: y(pMin), r: 3.4, fill: "#ffffff", stroke: p.color, "stroke-width": 1.6 }));
    }
    if (p.max !== undefined) {
      const pMax = at(p.max);
      parts.push(selfClosing("line", { x1: x(p.max), y1: y(pMax), x2: x(p.max), y2: plot.top + plot.height, stroke: p.color, "stroke-width": 1, "stroke-dasharray": "1.5 3", opacity: 0.55 }));
      parts.push(selfClosing("circle", { cx: x(p.max), cy: y(pMax), r: 3.4, fill: "#ffffff", stroke: p.color, "stroke-width": 1.6 }));
    }

    if (p.observed) {
      const pct = Math.round(p.observed.proportion * 100);
      observedMarkers.push({
        xx: x(p.median),
        color: p.color,
        yValue: p.observed.proportion,
        yLowValue: p.observed.ciLower,
        yHighValue: p.observed.ciUpper,
        line1: `${pct}%`,
        line2: `${p.observed.responders}/${p.observed.n}`
      });
    }
  }
  for (const b of input.observedBins ?? []) {
    const pct = Math.round(b.proportion * 100);
    observedMarkers.push({
      xx: x(b.x),
      color: b.color ?? "#0f172a",
      yValue: b.proportion,
      yLowValue: b.ciLower,
      yHighValue: b.ciUpper,
      line1: `${pct}%`,
      line2: `${b.responders}/${b.n}`
    });
  }

  // reference-line fit markers (opt-in): at each active median/tertile/quartile split line, show
  // the logistic curve's own fitted probability + CI at that exposure - so "click median"
  // answers not just "where is the cut point" (already shown by the dashed line + top label) but
  // also "what does the model predict there", right on the curve itself. Rendered in a lighter
  // grey than the (near-black) observed-rate markers, since the two are easy to confuse when
  // both are visible at once - this one is the model's fit, not an observed count.
  if (input.showReferenceFit) {
    for (const ref of input.referenceLines ?? []) {
      if (ref.value < input.xDomain[0] || ref.value > input.xDomain[1]) continue;
      const bandSource = input.band ?? input.curve;
      const fit = interpolateEstimate(input.curve.estimates, ref.value);
      const ci = interpolateFullEstimate(bandSource.estimates, ref.value);
      const valueText = ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1);
      observedMarkers.push({
        xx: x(ref.value),
        color: "#94a3b8",
        yValue: fit,
        yLowValue: ci.lower,
        yHighValue: ci.upper,
        line1: valueText,
        line2: `fit ${fit.toFixed(2)} [${ci.lower.toFixed(2)}-${ci.upper.toFixed(2)}]`
      });
    }
  }

  // axes
  let axis = "";
  axis += selfClosing("line", { x1: plot.left, y1: plot.top + plot.height, x2: plot.left + plot.width, y2: plot.top + plot.height, stroke: "#94a3b8" });
  axis += selfClosing("line", { x1: plot.left, y1: plot.top, x2: plot.left, y2: plot.top + plot.height, stroke: "#94a3b8" });
  for (let i = 0; i <= xTicks; i++) {
    const xv = input.xDomain[0] + (input.xDomain[1] - input.xDomain[0]) * (i / xTicks);
    const xx = x(xv);
    axis += selfClosing("line", { x1: xx, y1: plot.top + plot.height, x2: xx, y2: plot.top + plot.height + 6, stroke: "#94a3b8" });
    axis += tag("text", { x: xx, y: plot.top + plot.height + 22, "text-anchor": "middle", fill: "#667085", "font-size": 12 }, esc(xv >= 100 ? xv.toFixed(0) : xv.toFixed(1)));
  }
  for (const v of [0, 1]) {
    const yy = y(v);
    axis += selfClosing("line", { x1: plot.left - 6, y1: yy, x2: plot.left, y2: yy, stroke: "#94a3b8" });
    axis += tag("text", { x: plot.left - 10, y: yy + 4, "text-anchor": "end", fill: "#667085", "font-size": 12 }, esc(v));
  }
  // positioned relative to the plot's own bottom edge (not the overall chart height) so it stays
  // put immediately under the tick labels
  axis += tag("text", { x: plot.left + plot.width / 2, y: plot.top + plot.height + 40, "text-anchor": "middle", fill: "#334155", "font-size": 13, "font-weight": 700 }, esc(input.options.xAxisLabel));
  axis += tag(
    "text",
    { x: 18, y: plot.top + plot.height / 2, transform: `rotate(-90 18 ${plot.top + plot.height / 2})`, "text-anchor": "middle", fill: "#334155", "font-size": 13, "font-weight": 700 },
    esc(input.options.yAxisLabel)
  );
  parts.push(tag("g", { class: "er-axis" }, axis));

  parts.push(renderReferenceLines(input.referenceLines, input.xDomain, x, plot));

  // scatter points
  let dots = "";
  for (const p of input.points) {
    const cx = x(p.exposure);
    const cy = y(p.displayY ?? p.response);
    const color = input.groupColors[String(p.groupId)] ?? "#64748b";
    dots += tag(
      "circle",
      {
        cx,
        cy,
        r: p.selected ? 4.2 : 3.1,
        fill: color,
        opacity: p.selected ? 0.84 : 0.14,
        stroke: p.selected ? "#ffffff" : "none",
        "stroke-width": 1,
        "data-id": p.id,
        "data-group": p.groupId,
        "data-exposure": p.exposure,
        "data-response": p.response
      },
      p.label ? tag("title", {}, esc(p.label)) : ""
    );
  }
  parts.push(tag("g", { class: "er-points" }, dots));

  parts.push(renderMarkers(observedMarkers, y, plot.top, plot.top + plot.height));

  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${parts.join("")}</svg>`;

  return {
    outputType: "svg",
    content: svg,
    metadata: {
      width,
      height,
      plot,
      xScale: { domain: x.domain, range: x.range },
      yScale: { domain: y.domain, range: y.range }
    }
  };
}

function interpolateEstimate(estimates: PredictionResult["estimates"], exposure: number): number {
  if (!estimates.length) return NaN;
  if (exposure <= estimates[0].exposure) return estimates[0].estimate;
  const last = estimates[estimates.length - 1];
  if (exposure >= last.exposure) return last.estimate;
  for (let i = 0; i < estimates.length - 1; i++) {
    const a = estimates[i];
    const b = estimates[i + 1];
    if (exposure >= a.exposure && exposure <= b.exposure) {
      const t = (exposure - a.exposure) / (b.exposure - a.exposure || 1);
      return a.estimate + t * (b.estimate - a.estimate);
    }
  }
  return last.estimate;
}

/** Like `interpolateEstimate`, but also interpolates the CI bounds (`lower`/`upper`) alongside
 * the point estimate - used for reference-line fit markers, which need to report a full
 * "fit x.xx [lo-hi]" at an arbitrary exposure value, not just the point estimate. */
function interpolateFullEstimate(estimates: PredictionResult["estimates"], exposure: number): { estimate: number; lower: number; upper: number } {
  if (!estimates.length) return { estimate: NaN, lower: NaN, upper: NaN };
  const first = estimates[0];
  if (exposure <= first.exposure) return { estimate: first.estimate, lower: first.lower, upper: first.upper };
  const last = estimates[estimates.length - 1];
  if (exposure >= last.exposure) return { estimate: last.estimate, lower: last.lower, upper: last.upper };
  for (let i = 0; i < estimates.length - 1; i++) {
    const a = estimates[i];
    const b = estimates[i + 1];
    if (exposure >= a.exposure && exposure <= b.exposure) {
      const t = (exposure - a.exposure) / (b.exposure - a.exposure || 1);
      return {
        estimate: a.estimate + t * (b.estimate - a.estimate),
        lower: a.lower + t * (b.lower - a.lower),
        upper: a.upper + t * (b.upper - a.upper)
      };
    }
  }
  return { estimate: last.estimate, lower: last.lower, upper: last.upper };
}

/* ---------------------------------------------------------------------- *
 * Linked exposure boxplot chart (one horizontal box per group)
 * ---------------------------------------------------------------------- */

export interface BoxplotGroup {
  groupId: string | number;
  label: string;
  color: string;
  summary: DistributionSummary;
  n: number;
  nResponders?: number;
  selected?: boolean;
}

export interface BoxplotChartInput {
  groups: BoxplotGroup[];
  xDomain: [number, number];
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  options: ChartOptions;
}

export function renderBoxplotChart(input: BoxplotChartInput): RenderResult {
  const width = input.width ?? 1200;
  const groups = input.groups;
  const height = input.height ?? Math.max(160, 60 * groups.length + 60);
  const margin = input.margin ?? { top: 30, right: 20, bottom: 56, left: 96 };
  const plot = { left: margin.left, top: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
  const x = scaleLinear(input.xDomain, [plot.left, plot.left + plot.width]);
  const band = plot.height / Math.max(1, groups.length);
  const boxH = Math.min(44, band * 0.48);

  const parts: string[] = [];

  let grid = "";
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const vv = input.xDomain[0] + (input.xDomain[1] - input.xDomain[0]) * (i / ticks);
    const xx = x(vv);
    grid += selfClosing("line", { x1: xx, y1: plot.top, x2: xx, y2: plot.top + plot.height, stroke: "#edf1f7" });
  }
  parts.push(tag("g", { class: "er-grid" }, grid));

  let axis = "";
  for (let i = 0; i <= ticks; i++) {
    const vv = input.xDomain[0] + (input.xDomain[1] - input.xDomain[0]) * (i / ticks);
    const xx = x(vv);
    axis += selfClosing("line", { x1: xx, y1: plot.top + plot.height, x2: xx, y2: plot.top + plot.height + 6, stroke: "#94a3b8" });
    axis += tag("text", { x: xx, y: plot.top + plot.height + 22, "text-anchor": "middle", fill: "#667085", "font-size": 12 }, esc(vv >= 100 ? vv.toFixed(0) : vv.toFixed(1)));
  }
  axis += tag("text", { x: plot.left + plot.width / 2, y: height - 12, "text-anchor": "middle", fill: "#334155", "font-size": 13, "font-weight": 700 }, esc(input.options.xAxisLabel));
  parts.push(tag("g", { class: "er-axis" }, axis));

  let boxes = "";
  groups.forEach((g, i) => {
    const cy = plot.top + band * (i + 0.5);
    const s = g.summary;
    const color = g.color;
    let group = "";
    group += selfClosing("line", { x1: x(s.whiskerLow), y1: cy, x2: x(s.q1), y2: cy, stroke: color, "stroke-width": 1.4, opacity: 0.7 });
    group += selfClosing("line", { x1: x(s.q3), y1: cy, x2: x(s.whiskerHigh), y2: cy, stroke: color, "stroke-width": 1.4, opacity: 0.7 });
    group += selfClosing("rect", {
      x: x(s.q1),
      y: cy - boxH / 2,
      width: Math.max(1, x(s.q3) - x(s.q1)),
      height: boxH,
      fill: g.selected ? color : "#ffffff",
      opacity: g.selected ? 0.28 : 1,
      stroke: color,
      "stroke-width": g.selected ? 2.4 : 1.6,
      rx: 4
    });
    group += selfClosing("line", { x1: x(s.median), y1: cy - boxH / 2, x2: x(s.median), y2: cy + boxH / 2, stroke: color, "stroke-width": 2.4 });
    boxes += tag("g", { class: "er-box", "data-group": g.groupId, style: "cursor:pointer" }, group);

    boxes += tag("text", { x: plot.left - 12, y: cy + 4, "text-anchor": "end", fill: "#334155", "font-size": 12, "font-weight": 700 }, esc(g.label));
    const countLabel = g.nResponders !== undefined ? `n=${g.n} (${g.nResponders} resp.)` : `n=${g.n}`;
    boxes += tag("text", { x: width - 8, y: cy + 4, "text-anchor": "end", fill: "#475569", "font-size": 12 }, esc(countLabel));
  });
  parts.push(tag("g", { class: "er-boxes" }, boxes));

  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${parts.join("")}</svg>`;

  return {
    outputType: "svg",
    content: svg,
    metadata: { width, height, plot, xScale: { domain: x.domain, range: x.range }, band, boxH }
  };
}

/* ---------------------------------------------------------------------- *
 * Boxplot <-> distribution chart (animatable)
 *
 * Both representations are rendered as the same primitive: a closed ridge
 * polygon per group, built from a shared array of x-sample points and a
 * per-sample top/bottom pixel offset from the row's center line. A boxplot
 * is the ridge with a stepped, *mirrored* offset profile (flat within the
 * IQR, thin across the whiskers, zero beyond - top and bottom equal); the
 * "distribution" mode is a one-sided ("half violin") ridge instead - its
 * top offset comes from a Gaussian KDE, while its bottom offset is pinned
 * to a flat baseline (the box's own half-height, so that edge doesn't jump
 * when morphing from one mode to the other), so only the upper half of
 * what would otherwise be a mirrored violin is ever drawn. Because both
 * keyframes are defined over the *same* x-samples, the app layer can
 * linearly interpolate between them frame by frame (a plain numeric lerp,
 * independently for top and bottom) and feed the result back into
 * buildAsymRidgePath to get a smooth morph - no DOM diffing needed, and no
 * dependency on D3.
 * ---------------------------------------------------------------------- */

export type DistributionMode = "boxplot" | "violin" | "lineranges";

/** Build the shared x-sample grid for one group: an even base grid across the
 * whole domain, plus the group's own distribution breakpoints so box edges
 * land exactly on q1/q3/whiskers instead of being snapped to the nearest
 * grid point. */
function buildSampleGrid(xDomain: [number, number], stepBreakpoints: number[], baseCount: number): number[] {
  const [lo, hi] = xDomain;
  const span = hi - lo || 1;
  const eps = span * 1e-4;
  const base = Array.from({ length: baseCount + 1 }, (_, i) => lo + (span * i) / baseCount);
  // each step breakpoint gets a "just before" and "just after" point (rather than one point
  // exactly on the boundary) so the box profile can jump vertically there instead of sloping
  const stepPairs = stepBreakpoints.filter((v) => isFinite(v)).flatMap((v) => [v - eps, v + eps]);
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const rounded = [...base, ...stepPairs.map(clamp)].map((v) => Math.round(v * 1e6) / 1e6);
  return [...new Set(rounded)].sort((a, b) => a - b);
}

/** Stepped box-profile half-heights (in pixels) over `xSamples`: full box height within
 * [q1,q3], a thin whisker sliver within [whiskerLow,whiskerHigh], zero elsewhere. */
export function boxHalfHeightsPx(summary: DistributionSummary, xSamples: number[], boxHalfHeightPx: number, whiskerHalfHeightPx: number): number[] {
  return xSamples.map((x) => {
    if (x >= summary.q1 && x <= summary.q3) return boxHalfHeightPx;
    if (x >= summary.whiskerLow && x <= summary.whiskerHigh) return whiskerHalfHeightPx;
    return 0;
  });
}

/** Build a closed ridge polygon path from independent per-sample top and bottom offsets
 * (pixels, each measured away from `cy`). A mirrored violin is just the special case where
 * `topPx === bottomPx`; a one-sided ("half violin") distribution uses a small constant
 * `bottomPx` (a flat baseline) with `topPx` tracing the density curve. */
export function buildAsymRidgePath(xSamples: number[], topPx: number[], bottomPx: number[], xScale: Scale, cy: number): string {
  const top = xSamples.map((xv, i) => [xScale(xv), cy - topPx[i]] as [number, number]);
  const bottom = xSamples
    .map((xv, i) => [xScale(xv), cy + bottomPx[i]] as [number, number])
    .reverse();
  return buildLinePath(top.concat(bottom)) + " Z";
}

/** Build a closed, mirrored ridge/violin polygon path from per-sample half-heights (pixels). */
export function buildRidgePath(xSamples: number[], halfHeightsPx: number[], xScale: Scale, cy: number): string {
  return buildAsymRidgePath(xSamples, halfHeightsPx, halfHeightsPx, xScale, cy);
}

export interface DistributionSplitAnnotation {
  /** domain-space x value (same units as xDomain) marking the center of this bin */
  x: number;
  label: string;
}

export interface DistributionGroupInput {
  groupId: string | number;
  label: string;
  color: string;
  values: number[];
  n: number;
  nResponders?: number;
  selected?: boolean;
  /** Skip rendering a box/violin shape for this group (e.g. Placebo, whose exposure is a
   * constant zero by design) - the row still renders its label and N count, just no shape. */
  skipShape?: boolean;
  /** Per-group split annotations (count of this group's own patients falling in each bin of the
   * active reference-line split), rendered as small plain-text labels above the row. Optional -
   * pass undefined/empty to omit entirely (e.g. when the user has toggled this off). */
  splitAnnotations?: DistributionSplitAnnotation[];
}

export interface DistributionChartInput {
  groups: DistributionGroupInput[];
  xDomain: [number, number];
  mode: DistributionMode;
  referenceLines?: ReferenceLine[];
  xSampleCount?: number;
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  options: ChartOptions;
}

export interface DistributionGroupMeta {
  groupId: string | number;
  cy: number;
  color: string;
  xSamples: number[];
  boxHalfHeights: number[];
  densityHalfHeights: number[];
}

/** Whisker rendered as a hairline (traditional boxplot convention: the box spans exactly
 * Q1-Q3, and a thin line connects it to the 1.5*IQR whisker bound). */
const WHISKER_HAIRLINE_PX = 1;

export function renderDistributionChart(input: DistributionChartInput): RenderResult {
  const width = input.width ?? 1200;
  const groups = input.groups;
  const height = input.height ?? Math.max(160, 60 * groups.length + 60);
  const margin = input.margin ?? { top: 30, right: 20, bottom: 56, left: 96 };
  const plot = { left: margin.left, top: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
  const x = scaleLinear(input.xDomain, [plot.left, plot.left + plot.width]);
  const band = plot.height / Math.max(1, groups.length);
  const boxHalfHeightPx = Math.min(22, band * 0.24);
  const whiskerHalfHeightPx = WHISKER_HAIRLINE_PX;
  const capHalfHeightPx = boxHalfHeightPx * 0.5;
  const baseCount = input.xSampleCount ?? 60;

  const summaries = groups.map((g) => summarizeDistribution(g.values));

  // per-group KDE, sampled on that group's own breakpoint-aware grid. Critically, the grid only
  // spans that group's own data range (+ a small bandwidth-based pad for a natural taper) rather
  // than the shared chart-wide xDomain - otherwise the shape (and its flat "distribution mode"
  // baseline) would stretch as a stray flat line across x-values the group has no data anywhere
  // near, instead of tapering down to nothing right around its own min/max.
  const perGroup = groups.map((g, i) => {
    if (g.skipShape) return { xSamples: [] as number[], rawDensity: [] as number[], summary: null };
    const summary = summaries[i];
    if (!summary) return { xSamples: buildSampleGrid(input.xDomain, [], baseCount), rawDensity: [] as number[], summary: null };
    const bandwidth = silvermanBandwidth(g.values);
    const pad = Math.max(bandwidth * 2.5, (summary.max - summary.min) * 0.02);
    const localDomain: [number, number] = [
      Math.max(input.xDomain[0], summary.min - pad),
      Math.min(input.xDomain[1], summary.max + pad)
    ];
    const xSamples = buildSampleGrid(
      localDomain,
      [summary.whiskerLow, summary.q1, summary.q3, summary.whiskerHigh, summary.min, summary.max],
      baseCount
    );
    const rawDensity = kernelDensityEstimate(g.values, xSamples, bandwidth);
    return { xSamples, rawDensity, summary };
  });

  const parts: string[] = [];

  let grid = "";
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const vv = input.xDomain[0] + (input.xDomain[1] - input.xDomain[0]) * (i / ticks);
    const xx = x(vv);
    grid += selfClosing("line", { x1: xx, y1: plot.top, x2: xx, y2: plot.top + plot.height, stroke: "#edf1f7" });
  }
  parts.push(tag("g", { class: "er-grid" }, grid));

  let axis = "";
  for (let i = 0; i <= ticks; i++) {
    const vv = input.xDomain[0] + (input.xDomain[1] - input.xDomain[0]) * (i / ticks);
    const xx = x(vv);
    axis += selfClosing("line", { x1: xx, y1: plot.top + plot.height, x2: xx, y2: plot.top + plot.height + 6, stroke: "#94a3b8" });
    axis += tag("text", { x: xx, y: plot.top + plot.height + 22, "text-anchor": "middle", fill: "#667085", "font-size": 12 }, esc(vv >= 100 ? vv.toFixed(0) : vv.toFixed(1)));
  }
  axis += tag("text", { x: plot.left + plot.width / 2, y: height - 12, "text-anchor": "middle", fill: "#334155", "font-size": 13, "font-weight": 700 }, esc(input.options.xAxisLabel));
  parts.push(tag("g", { class: "er-axis" }, axis));

  const groupMeta: DistributionGroupMeta[] = [];
  let shapes = "";
  groups.forEach((g, i) => {
    const cy = plot.top + band * (i + 0.5);

    if (g.skipShape) {
      // still a clickable row (for consistency with the other groups) but no box/violin shape -
      // e.g. Placebo, whose exposure is a constant zero by design.
      const hit = selfClosing("rect", { x: plot.left, y: cy - band / 2 + 1, width: plot.width, height: band - 2, fill: "transparent" });
      shapes += tag("g", { class: "er-ridge", "data-group": g.groupId, style: "cursor:pointer" }, hit);
      shapes += tag("text", { x: plot.left - 12, y: cy + 4, "text-anchor": "end", fill: "#334155", "font-size": 12, "font-weight": 700 }, esc(g.label));
      const countLabel = g.nResponders !== undefined ? `n=${g.n} (${g.nResponders} resp.)` : `n=${g.n}`;
      shapes += tag("text", { x: width - 8, y: cy + 4, "text-anchor": "end", fill: "#475569", "font-size": 12 }, esc(countLabel));
      groupMeta.push({ groupId: g.groupId, cy, color: g.color, xSamples: [], boxHalfHeights: [], densityHalfHeights: [] });
      return;
    }

    const { xSamples, rawDensity, summary } = perGroup[i];
    const boxHH = summary ? boxHalfHeightsPx(summary, xSamples, boxHalfHeightPx, whiskerHalfHeightPx) : xSamples.map(() => 0);
    // normalized per-group (classic violin convention): each violin's own peak maps to the
    // same max width, so shape is comparable across groups regardless of absolute density scale
    const groupMaxDensity = Math.max(1e-9, ...rawDensity);
    const densityHH = rawDensity.map((d) => (d / groupMaxDensity) * boxHalfHeightPx);
    // boxplot mode is a fully mirrored ridge (top === bottom); distribution mode is a "half
    // violin" - only the top edge traces the density curve, while the bottom edge sits flush on
    // a flat baseline (reusing the box's own bottom edge height for visual continuity when
    // morphing between the two modes), so it reads as a single-sided density rather than a
    // mirrored blob.
    const flatBaseline = xSamples.map(() => boxHalfHeightPx);
    const activeTop = input.mode === "boxplot" ? boxHH : densityHH;
    const activeBottom = input.mode === "boxplot" ? boxHH : flatBaseline;

    // an invisible full-row hit target (inside the same group as the visible shape, so a
    // click anywhere in the row - not just on the shape itself - bubbles to the group)
    let group = selfClosing("rect", { x: plot.left, y: cy - band / 2 + 1, width: plot.width, height: band - 2, fill: "transparent" });

    if (input.mode === "lineranges") {
      // Flattened boxplot: a single horizontal min-max bar with Q1/Q3 tick marks and a filled
      // median dot, no filled area - same visual language as the "Compare endpoints" view's own
      // per-endpoint dose-ranges strip, just colored by dose instead of by endpoint, and living
      // in this chart's normal group/click/Group-N infrastructure so it gets full parity with
      // Boxplot/Distribution (Group N counts, click-to-project, reference-line split values)
      // rather than being a separate, more limited mechanism.
      if (summary) {
        group += selfClosing("line", {
          x1: x(summary.min),
          y1: cy,
          x2: x(summary.max),
          y2: cy,
          stroke: g.color,
          "stroke-width": 5,
          "stroke-linecap": "round",
          opacity: g.selected ? 0.85 : 0.55
        });
        for (const q of [summary.q1, summary.q3]) {
          const qx = x(q);
          group += selfClosing("line", { x1: qx, y1: cy - 5, x2: qx, y2: cy + 5, stroke: g.color, "stroke-width": 2, opacity: 0.9 });
        }
        group += selfClosing("circle", { cx: x(summary.median), cy, r: 4, fill: g.color, stroke: "#fff", "stroke-width": 1.2 });
      }
    } else {
      const path = buildAsymRidgePath(xSamples, activeTop, activeBottom, x, cy);
      group += selfClosing("path", {
        class: "er-ridge-shape",
        d: path,
        fill: g.selected ? g.color : "#ffffff",
        opacity: g.selected ? 0.32 : input.mode === "boxplot" ? 1 : 0.85,
        stroke: g.color,
        "stroke-width": g.selected ? 2.4 : 1.6
      });
      if (summary) {
        group += selfClosing("line", {
          x1: x(summary.median),
          y1: cy - boxHalfHeightPx,
          x2: x(summary.median),
          y2: cy + boxHalfHeightPx,
          stroke: g.color,
          "stroke-width": 2.4
        });
        // Q1/Q3 markers: always visible (not mode-gated) since these are the exact values used
        // for this dose's projection onto the fit above, regardless of whether the row is
        // currently shown as a boxplot or a distribution.
        let iqrLines = selfClosing("line", { x1: x(summary.q1), y1: cy - boxHalfHeightPx, x2: x(summary.q1), y2: cy + boxHalfHeightPx, stroke: g.color, "stroke-width": 1.4, "stroke-dasharray": "3 3", opacity: 0.8 });
        iqrLines += selfClosing("line", { x1: x(summary.q3), y1: cy - boxHalfHeightPx, x2: x(summary.q3), y2: cy + boxHalfHeightPx, stroke: g.color, "stroke-width": 1.4, "stroke-dasharray": "3 3", opacity: 0.8 });
        group += tag("g", { class: "er-iqr-lines" }, iqrLines);
        // whisker end-caps: a traditional boxplot convention, only meaningful in box mode (the
        // ridge itself already renders as a hairline that would otherwise look like a bare line)
        const capOpacity = input.mode === "boxplot" ? 1 : 0;
        let caps = selfClosing("line", { x1: x(summary.whiskerLow), y1: cy - capHalfHeightPx, x2: x(summary.whiskerLow), y2: cy + capHalfHeightPx, stroke: g.color, "stroke-width": 1.6 });
        caps += selfClosing("line", { x1: x(summary.whiskerHigh), y1: cy - capHalfHeightPx, x2: x(summary.whiskerHigh), y2: cy + capHalfHeightPx, stroke: g.color, "stroke-width": 1.6 });
        group += tag("g", { class: "er-caps", opacity: capOpacity }, caps);
      }
    }
    if (g.splitAnnotations?.length) {
      // per-group split counts (e.g. how many of this row's own patients fall in each tertile
      // bin): plain small text, no background/border, sitting above the shape rather than on
      // top of it - a bordered callout there was tried first but reviewers found it made it
      // hard to tell the annotation apart from the box/violin shape itself. Positioned relative
      // to the box's own fixed half-height (not the row's full band) so it clears the shape by a
      // consistent gap regardless of how tall/short the row's band happens to be - anchoring to
      // band/2 instead could land the text inside the box once bands got tall enough (e.g. many
      // rows packed into a "split by endpoint" view) for boxHalfHeightPx to be much smaller than
      // band/2.
      let anns = "";
      g.splitAnnotations.forEach((a) => {
        const xx = x(a.x);
        anns += tag(
          "text",
          { x: xx, y: cy - boxHalfHeightPx - 6, "text-anchor": "middle", fill: g.color, "font-size": 10.5, "font-weight": 700, opacity: 0.85 },
          esc(a.label)
        );
      });
      group += tag("g", { class: "er-split-annotations" }, anns);
    }
    shapes += tag("g", { class: "er-ridge", "data-group": g.groupId, style: "cursor:pointer" }, group);

    shapes += tag("text", { x: plot.left - 12, y: cy + 4, "text-anchor": "end", fill: "#334155", "font-size": 12, "font-weight": 700 }, esc(g.label));
    const countLabel = g.nResponders !== undefined ? `n=${g.n} (${g.nResponders} resp.)` : `n=${g.n}`;
    shapes += tag("text", { x: width - 8, y: cy + 4, "text-anchor": "end", fill: "#475569", "font-size": 12 }, esc(countLabel));

    groupMeta.push({ groupId: g.groupId, cy, color: g.color, xSamples, boxHalfHeights: boxHH, densityHalfHeights: densityHH });
  });
  parts.push(tag("g", { class: "er-distribution" }, shapes));

  parts.push(renderReferenceLines(input.referenceLines, input.xDomain, x, plot, true));

  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${parts.join("")}</svg>`;

  return {
    outputType: "svg",
    content: svg,
    metadata: { width, height, plot, xScale: { domain: x.domain, range: x.range }, band, boxHalfHeightPx, mode: input.mode, groups: groupMeta }
  };
}
