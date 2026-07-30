import type { DrawContext, Layer } from "../types";

export interface ReferenceLineSpec {
  value: number;
  /** Short label naming the cut point (e.g. `"T1 (33%)"`), staggered into one of two rows above
   * the plot so it doesn't collide with a neighboring reference line's label. */
  label: string;
  /** Pre-formatted value printed beneath the line near the plot's bottom edge (e.g. `"83.8"`),
   * independent of `label` above and staggered into its own two rows. Omit to hide. */
  valueLabel?: string;
  /**
   * When present, also pushes a stacked observed-style marker (dot + CI + two label lines) at
   * this line's x position - e.g. a fitted curve's own value + CI at this cut point
   * (`"Fit 0.74"` / `"[0.70-0.78]"`), ported from the current renderer's `showReferenceFit`.
   * Laid out jointly with any `ObservedStat` markers competing for the same x-region, since both
   * go through the same shared marker collector - not routed through this layer's own
   * label-staggering (see the class doc below). The caller computes the value itself (e.g. via
   * `interpolateCurveSample`); `AnnotationLayer` never samples a curve on its own.
   */
  markerValue?: { estimate: number; lower: number; upper: number; lines?: [string, string]; color?: string };
}

export interface AnnotationLayerOptions {
  id: string;
  lines: ReferenceLineSpec[];
  color?: string;
  markerColor?: string;
}

const DEFAULT_LINE_COLOR = "#0f172a";
const DEFAULT_VALUE_COLOR = "#94a3b8";

/**
 * Vertical reference lines (median/tertile/quartile splits) spanning the full plot height, with
 * a name label above and an optional value label below - ported from the current renderer's
 * `renderReferenceLines`.
 *
 * Deliberately **not** routed through the shared `MarkerCandidate` system: a full-height guide
 * line + a short alternating-row text label is a genuinely different layout problem (x-only,
 * fixed anchor rows near the plot's top/bottom edge) from the stacked dot+CI+label-box markers
 * `ObservedStat` uses (x-clustered, vertically free-floating around a data value) - forcing them
 * through one algorithm would make the reference-line labels behave worse, not better. This
 * corrects an earlier, more optimistic claim in docs/RENDERER_ARCHITECTURE.md §4 that the two
 * would fully unify; what *does* unify (§5/§6) is `markerValue` above, which is the one
 * `showReferenceFit`-style feature that genuinely shared the marker stack in the original code.
 */
export class AnnotationLayer implements Layer {
  readonly kind = "annotation" as const;
  readonly id: string;

  constructor(private readonly options: AnnotationLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { lines, color = DEFAULT_LINE_COLOR, markerColor } = this.options;
    if (!lines.length) return;

    const { plotRect, xScale, yScale, target } = ctx;
    const [domainLo, domainHi] = xScale.domain;
    const visible = lines.filter((l) => l.value >= domainLo && l.value <= domainHi).sort((a, b) => a.value - b.value);
    if (!visible.length) return;

    target.group({ class: `er-reference-lines ${this.id}` }, () => {
      const rowRightEdge = [-Infinity, -Infinity];
      let row = 0;
      const bottomRowRightEdge = [-Infinity, -Infinity];
      let bottomRow = 0;

      for (const ref of visible) {
        const xx = xScale(ref.value);

        target.drawLine(
          [
            { x: xx, y: plotRect.y },
            { x: xx, y: plotRect.y + plotRect.height }
          ],
          { stroke: color, strokeWidth: 1.4, dash: "3 3", opacity: 0.55 }
        );

        if (xx < rowRightEdge[row]) row = 1 - row;
        target.drawText(xx + 4, plotRect.y + 11 + row * 12, ref.label, {
          textAnchor: "start",
          fill: color,
          fontSize: 10.5,
          fontWeight: 700,
          opacity: 0.75
        });
        rowRightEdge[row] = xx + 4 + ref.label.length * 6.3;

        if (ref.valueLabel) {
          const halfWidth = (ref.valueLabel.length * 6.4) / 2 + 3;
          if (xx - halfWidth < bottomRowRightEdge[bottomRow]) bottomRow = 1 - bottomRow;
          target.drawText(xx, plotRect.y + plotRect.height - 6 - bottomRow * 13, ref.valueLabel, {
            textAnchor: "middle",
            fill: DEFAULT_VALUE_COLOR,
            fontSize: 10.5,
            fontWeight: 700,
            opacity: 0.9
          });
          bottomRowRightEdge[bottomRow] = xx + halfWidth;
        }

        if (ref.markerValue) {
          const mv = ref.markerValue;
          const [line1, line2] = mv.lines ?? [`Fit ${mv.estimate.toFixed(2)}`, `[${mv.lower.toFixed(2)}-${mv.upper.toFixed(2)}]`];
          ctx.markers.add({
            id: `${this.id}:marker:${ref.value}`,
            ownerLayerId: this.id,
            x: xx,
            y: yScale(mv.estimate),
            yLow: yScale(mv.lower),
            yHigh: yScale(mv.upper),
            color: mv.color ?? markerColor ?? DEFAULT_VALUE_COLOR,
            lines: [line1, line2],
            kind: "reference-fit"
          });
        }
      }
    });
  }
}
