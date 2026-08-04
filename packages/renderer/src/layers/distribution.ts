import { buildAsymRidgePath } from "../distributionShape";
import type { DrawContext, Layer } from "../types";

export type DistributionMode = "boxplot" | "violin" | "lineranges";

export interface DistributionSplitAnnotation {
  /** domain-space x value marking the center of this bin */
  x: number;
  label: string;
}

/** Pre-computed quantile summary this Layer needs to draw a group's median/IQR/whisker/
 * lineranges geometry - it never computes this itself (see `xSamples`/`boxHalfHeights`/
 * `densityHalfHeights` below). */
export interface DistributionGroupSummary {
  q1: number;
  q3: number;
  median: number;
  whiskerLow: number;
  whiskerHigh: number;
  min: number;
  max: number;
}

export interface DistributionGroupDatum {
  groupId: string | number;
  /** Row label, e.g. a dose name - printed once per row (pass `""` for a sub-row that shares its
   * label with a preceding row, e.g. "Compare endpoints"'s per-endpoint split). */
  label: string;
  color: string;
  n: number;
  nResponders?: number;
  selected?: boolean;
  /** Row highlight when selected (defaults to `color`). Use when shape color is endpoint-specific but selection should stay neutral. */
  selectionColor?: string;
  /** Skip rendering a box/violin/lineranges shape for this group (e.g. Placebo, whose exposure
   * is a constant zero by design) - the row still renders its label, N count, and click target,
   * just no shape. */
  skipShape?: boolean;
  splitAnnotations?: DistributionSplitAnnotation[];
  /**
   * Shared x-sample grid this group's shape is traced over, plus its stepped box-profile and
   * (per-group-normalized) KDE half-heights (pixels) at each sample - all pre-computed by the
   * caller (docs/RENDERER_ARCHITECTURE.md dependency rule: this package never computes KDE
   * bandwidth or quantiles itself, since that's `@er-explorer/analysis` territory). Omit
   * (along with `summary`) for a `skipShape` group.
   */
  xSamples?: number[];
  boxHalfHeights?: number[];
  densityHalfHeights?: number[];
  summary?: DistributionGroupSummary;
}

export interface DistributionLayerOptions {
  id: string;
  groups: DistributionGroupDatum[];
  mode: DistributionMode;
}

/** One resolved row's pixel geometry, handed back via `ctx.layerData` (keyed by this Layer's own
 * `id`) so a caller can drive its own boxplot<->violin morph animation - re-interpolating
 * `boxHalfHeights`/`densityHalfHeights` frame by frame and re-calling `buildAsymRidgePath`
 * itself, entirely outside this Layer's `render()`. */
export interface DistributionGroupMeta {
  groupId: string | number;
  cy: number;
  color: string;
  xSamples: number[];
  boxHalfHeights: number[];
  densityHalfHeights: number[];
}

export interface DistributionLayerData {
  groups: DistributionGroupMeta[];
  boxHalfHeightPx: number;
  band: number;
}

/**
 * One row per group (dose, or a dose x endpoint sub-row in "Compare endpoints"), each drawn as a
 * Boxplot, Violin ("distribution"/half-violin), or Lineranges shape depending on `mode` - ported
 * from the current renderer's `renderDistributionChart`. Deliberately still one Layer covering
 * all three modes (not three separate Layer classes) since they share the same row layout, hit
 * target, label, and split-annotation placement, and only the shape itself differs - the same
 * "shared data, swappable draw strategy" the design doc flagged for this Layer, just resolved as
 * a `mode` string rather than a pluggable strategy object, since (unlike `Fit`/`ConfidenceRibbon`'s
 * `CurveStyle`) the three shapes' *inputs* (box half-heights vs. density half-heights vs. a plain
 * min/max summary) genuinely differ, not just their path-building math.
 *
 * Never draws reference lines or the x-axis/grid itself - a caller composes those from the
 * already-generic `GridLayer`/`AxisLayer`/`AnnotationLayer`, exactly like the scatter charts do.
 */
export class DistributionLayer implements Layer {
  readonly kind = "distribution" as const;
  readonly id: string;

  constructor(private readonly options: DistributionLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { groups, mode } = this.options;
    if (!groups.length) return;

    const { plotRect, xScale, target } = ctx;
    const band = plotRect.height / groups.length;
    const boxHalfHeightPx = Math.min(22, band * 0.24);
    const capHalfHeightPx = boxHalfHeightPx * 0.5;

    const groupMeta: DistributionGroupMeta[] = [];

    target.group({ class: `er-distribution ${this.id}` }, () => {
      groups.forEach((g, i) => {
        const cy = plotRect.y + band * (i + 0.5);
        const rowTop = cy - band / 2 + 1;
        const rowHeight = band - 2;

        if (g.skipShape) {
          target.group({ class: "er-ridge", "data-group": String(g.groupId), style: "cursor:pointer" }, () => {
            target.drawRect({ x: plotRect.x, y: rowTop, width: plotRect.width, height: rowHeight }, { fill: "transparent" });
          });
          this.drawRowLabels(ctx, g, cy);
          groupMeta.push({ groupId: g.groupId, cy, color: g.color, xSamples: [], boxHalfHeights: [], densityHalfHeights: [] });
          return;
        }

        const xSamples = g.xSamples ?? [];
        const boxHH = g.boxHalfHeights ?? [];
        const densityHH = g.densityHalfHeights ?? [];
        const summary = g.summary;

        target.group({ class: "er-ridge", "data-group": String(g.groupId), style: "cursor:pointer" }, () => {
          target.drawRect({ x: plotRect.x, y: rowTop, width: plotRect.width, height: rowHeight }, { fill: "transparent" });

          const highlight = g.selectionColor ?? g.color;

          if (mode === "lineranges") {
            if (summary) {
              target.drawLine(
                [
                  { x: xScale(summary.min), y: cy },
                  { x: xScale(summary.max), y: cy }
                ],
                { stroke: g.color, strokeWidth: 5, lineCap: "round", opacity: g.selected ? 0.85 : 0.55 }
              );
              for (const q of [summary.q1, summary.q3]) {
                const qx = xScale(q);
                target.drawLine(
                  [
                    { x: qx, y: cy - 5 },
                    { x: qx, y: cy + 5 }
                  ],
                  { stroke: g.color, strokeWidth: 2, opacity: 0.9 }
                );
              }
              target.drawCircle(xScale(summary.median), cy, 4, { fill: g.color, stroke: "#fff", strokeWidth: 1.2 });
            }
          } else {
            const flatBaseline = xSamples.map(() => boxHalfHeightPx);
            const activeTop = mode === "boxplot" ? boxHH : densityHH;
            const activeBottom = mode === "boxplot" ? boxHH : flatBaseline;
            const path = buildAsymRidgePath(xSamples, activeTop, activeBottom, xScale, cy);
            if (path) {
              target.drawArea(path, {
                fill: g.selected ? highlight : "#ffffff",
                opacity: g.selected ? 0.32 : mode === "boxplot" ? 1 : 0.85,
                stroke: g.selected ? highlight : g.color,
                strokeWidth: g.selected ? 2.4 : 1.6,
                attrs: { class: "er-ridge-shape" }
              });
            }
            if (summary) {
              target.drawLine(
                [
                  { x: xScale(summary.median), y: cy - boxHalfHeightPx },
                  { x: xScale(summary.median), y: cy + boxHalfHeightPx }
                ],
                { stroke: g.color, strokeWidth: 2.4 }
              );

              // Q1/Q3 markers: always visible (not mode-gated) since these are the exact values
              // used for this dose's projection onto the fit above, regardless of whether the
              // row is currently shown as a boxplot or a distribution.
              target.group({ class: "er-iqr-lines" }, () => {
                for (const q of [summary.q1, summary.q3]) {
                  const qx = xScale(q);
                  target.drawLine(
                    [
                      { x: qx, y: cy - boxHalfHeightPx },
                      { x: qx, y: cy + boxHalfHeightPx }
                    ],
                    { stroke: g.color, strokeWidth: 1.4, dash: "3 3", opacity: 0.8 }
                  );
                }
              });

              // whisker end-caps: a traditional boxplot convention, only meaningful in box mode
              // (the ridge itself already renders as a hairline that would otherwise look like a
              // bare line) - kept in the DOM rather than omitted in violin mode (opacity baked in
              // here for the initial render), so the boxplot<->violin morph animation can
              // cross-fade this group's own opacity attribute frame by frame.
              target.group({ class: "er-caps", opacity: String(mode === "boxplot" ? 1 : 0) }, () => {
                for (const wv of [summary.whiskerLow, summary.whiskerHigh]) {
                  const wx = xScale(wv);
                  target.drawLine(
                    [
                      { x: wx, y: cy - capHalfHeightPx },
                      { x: wx, y: cy + capHalfHeightPx }
                    ],
                    { stroke: g.color, strokeWidth: 1.6 }
                  );
                }
              });
            }
          }

          if (g.splitAnnotations?.length) {
            // per-group split counts: plain small text, positioned relative to the box's own
            // fixed half-height (not the row's full band) so it clears the shape by a consistent
            // gap regardless of how tall/short the row's band happens to be.
            target.group({ class: "er-split-annotations" }, () => {
              for (const a of g.splitAnnotations!) {
                target.drawText(xScale(a.x), cy - boxHalfHeightPx - 6, a.label, {
                  textAnchor: "middle",
                  fill: g.color,
                  fontSize: 10.5,
                  fontWeight: 700,
                  opacity: 0.85
                });
              }
            });
          }
        });

        this.drawRowLabels(ctx, g, cy);
        groupMeta.push({ groupId: g.groupId, cy, color: g.color, xSamples, boxHalfHeights: boxHH, densityHalfHeights: densityHH });
      });
    });

    ctx.layerData.set(this.id, { groups: groupMeta, boxHalfHeightPx, band } satisfies DistributionLayerData);
  }

  private drawRowLabels(ctx: DrawContext, g: DistributionGroupDatum, cy: number): void {
    const { plotRect, target } = ctx;
    target.drawText(plotRect.x - 12, cy + 4, g.label, {
      textAnchor: "end",
      fill: "#334155",
      fontSize: 12,
      fontWeight: 700
    });
    // Capital N (not "n=") - this is the row's *total* sample size (the standard statistical
    // convention: N for the full group, n for a sub-group/bin), to keep it visually distinct
    // from any per-bin "n=" counts shown elsewhere in the same chart (e.g. split annotations).
    const countLabel = g.nResponders !== undefined ? `N=${g.n} (${g.nResponders} resp.)` : `N=${g.n}`;
    target.drawText(ctx.width - 8, cy + 4, countLabel, {
      textAnchor: "end",
      fill: "#475569",
      fontSize: 12
    });
  }
}
