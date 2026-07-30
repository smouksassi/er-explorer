import type { CurveSample } from "../curveSample";
import { type CurveStyle, SmoothStyle } from "../curveStyle";
import type { DrawContext, Layer } from "../types";

export interface FitLayerOptions {
  id: string;
  /** Must be sorted ascending by `exposure` - the caller's responsibility, same as the current
   * renderer's `PredictionResult.estimates`. */
  samples: CurveSample[];
  color?: string;
  dash?: string;
  strokeWidth?: number;
  opacity?: number;
  /** Defaults to `SmoothStyle`. Pass `StepStyle` for a step-function endpoint type (e.g.
   * Kaplan-Meier). */
  style?: CurveStyle;
}

const DEFAULT_COLOR = "#64748b";
const DEFAULT_DASH = "7 5";

/**
 * A single fitted curve, drawn standalone - deliberately not bundled with its confidence
 * interval (see `ConfidenceRibbonLayer`) since `confidenceInterval()` can be unsupported,
 * unrequested, or expensive, and "Compare Endpoints" plausibly wants N fit lines but only one
 * curve's ribbon (docs/RENDERER_ARCHITECTURE.md section 3). Overlaying several endpoints is
 * just constructing several `FitLayer` instances, each its own color - no special multi-curve
 * type needed.
 */
export class FitLayer implements Layer {
  readonly kind = "fit" as const;
  readonly id: string;

  constructor(private readonly options: FitLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { samples, color = DEFAULT_COLOR, dash = DEFAULT_DASH, strokeWidth = 2, opacity = 0.85, style = SmoothStyle } = this.options;
    if (samples.length < 2) return;

    const points = samples.map((s) => ({ x: ctx.xScale(s.exposure), y: ctx.yScale(s.estimate) }));
    const d = style.buildPath(points);
    if (!d) return;

    ctx.target.group({ class: `er-fit ${this.id}` }, () => {
      ctx.target.drawArea(d, {
        fill: "none",
        stroke: color,
        strokeWidth,
        dash,
        opacity,
        lineCap: "round",
        lineJoin: "round"
      });
    });
  }
}
