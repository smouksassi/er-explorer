import { type CurveSample, interpolateCurveSample } from "../curveSample";
import type { DrawContext, Layer } from "../types";

export interface DoseProjectionGroup {
  color: string;
  q1: number;
  q3: number;
  median: number;
  /** This group's actual observed minimum/maximum exposure - optional, since a group with only
   * one distinct value may not have both. When present, a small hollow marker is drawn at the
   * curve's value there, in addition to the Q1/median/Q3 dots. */
  min?: number;
  max?: number;
}

export interface DoseProjectionLayerOptions {
  id: string;
  groups: DoseProjectionGroup[];
  /** The same fitted-curve samples the paired `FitLayer` instances draw from - used only to
   * read the curve's estimate at each group's Q1/Q3/median/min/max, via
   * `interpolateCurveSample()`. This Layer never draws the curve itself. */
  curveSamples: CurveSample[];
}

const MEDIAN_COLOR = "#111827";

/**
 * The geometric half of a dose-click projection (docs/RENDERER_ARCHITECTURE.md section 4): a
 * shaded Q1-Q3 background band, dashed guide lines down to Q1/Q3/min/max, and their dots plus a
 * dark median dot, all read off an already-fitted curve's own samples. Deliberately its own
 * purpose-built Layer rather than forced into `ObservedStat` (whose markers always carry a
 * labeled dot+CI+text box - these have no label at all) - the design doc flagged this exact
 * piece as its least-confident part and named a dedicated Layer as a legitimate escape hatch.
 * Uses `kind: "annotation"` (no new `LayerKind` needed just for one call site) since it's
 * decorative relative to a `Fit` curve, the same way reference lines are.
 *
 * The emphasized/muted curve segments themselves are two ordinary `FitLayer` instances (solid,
 * `dash: null`) built by the caller from the same `curveSamples` - not this Layer's job, so a
 * caller can still choose to omit them (e.g. showing only the projection markers).
 *
 * An observed value + CI per group (a responder rate or a mean) is a separate `ObservedStatBin`
 * for `ObservedStatLayer`, not part of this Layer either - it already has a generic shape for
 * exactly that.
 */
export class DoseProjectionLayer implements Layer {
  readonly kind = "annotation" as const;
  readonly id: string;

  constructor(private readonly options: DoseProjectionLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { groups, curveSamples } = this.options;
    if (!groups.length || curveSamples.length < 2) return;

    const { plotRect, xScale, yScale, target } = ctx;
    const estimateYAt = (exposure: number): number => yScale(interpolateCurveSample(curveSamples, exposure).estimate);
    const bottom = plotRect.y + plotRect.height;

    target.group({ class: `er-dose-projection ${this.id}` }, () => {
      for (const g of groups) {
        const xQ1 = xScale(g.q1);
        const xQ3 = xScale(g.q3);
        const yQ1 = estimateYAt(g.q1);
        const yQ3 = estimateYAt(g.q3);

        target.drawRect(
          { x: xQ1, y: plotRect.y + 2, width: Math.max(1, xQ3 - xQ1), height: plotRect.height - 4 },
          { fill: g.color, opacity: 0.06, rx: 8 }
        );

        target.drawLine(
          [
            { x: xQ1, y: yQ1 },
            { x: xQ1, y: bottom }
          ],
          { stroke: g.color, strokeWidth: 1.4, dash: "4 4", opacity: 0.75 }
        );
        target.drawLine(
          [
            { x: xQ3, y: yQ3 },
            { x: xQ3, y: bottom }
          ],
          { stroke: g.color, strokeWidth: 1.4, dash: "4 4", opacity: 0.75 }
        );
        target.drawCircle(xQ1, yQ1, 4.6, { fill: g.color, stroke: "#fff", strokeWidth: 1.2 });
        target.drawCircle(xQ3, yQ3, 4.6, { fill: g.color, stroke: "#fff", strokeWidth: 1.2 });
        target.drawCircle(xScale(g.median), estimateYAt(g.median), 4, { fill: MEDIAN_COLOR, stroke: "#fff", strokeWidth: 1.1 });

        if (g.min !== undefined) {
          const xMin = xScale(g.min);
          const yMin = estimateYAt(g.min);
          target.drawLine(
            [
              { x: xMin, y: yMin },
              { x: xMin, y: bottom }
            ],
            { stroke: g.color, strokeWidth: 1, dash: "1.5 3", opacity: 0.55 }
          );
          target.drawCircle(xMin, yMin, 3.4, { fill: "#ffffff", stroke: g.color, strokeWidth: 1.6 });
        }
        if (g.max !== undefined) {
          const xMax = xScale(g.max);
          const yMax = estimateYAt(g.max);
          target.drawLine(
            [
              { x: xMax, y: yMax },
              { x: xMax, y: bottom }
            ],
            { stroke: g.color, strokeWidth: 1, dash: "1.5 3", opacity: 0.55 }
          );
          target.drawCircle(xMax, yMax, 3.4, { fill: "#ffffff", stroke: g.color, strokeWidth: 1.6 });
        }
      }
    });
  }
}
