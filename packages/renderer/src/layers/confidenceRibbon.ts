import type { CurveSample } from "../curveSample";
import { buildBandPath, type CurveStyle, SmoothStyle } from "../curveStyle";
import type { DrawContext, Layer } from "../types";

export interface ConfidenceRibbonLayerOptions {
  id: string;
  /** Must be sorted ascending by `exposure`, same as `FitLayer.samples`. */
  samples: CurveSample[];
  color?: string;
  opacity?: number;
  /** Defaults to `SmoothStyle` - pass the same style as the paired `FitLayer` so the band and
   * its curve visually agree. */
  style?: CurveStyle;
}

const DEFAULT_COLOR = "#94a3b8";

/**
 * A confidence band, drawn standalone from its `Fit` line (docs/RENDERER_ARCHITECTURE.md
 * section 3) - so a caller can show a fit without a band (unsupported/unrequested/expensive CI),
 * or compare two CI methods as two `ConfidenceRibbonLayer`s over one `FitLayer`.
 *
 * All-or-nothing rendering, matching the current renderer's `bandPathFromEstimates`: if *any*
 * sample has a non-finite `lower`/`upper`, the whole band is skipped rather than silently
 * dropping just those points (which would draw a band with an oddly missing bite out of it).
 */
export class ConfidenceRibbonLayer implements Layer {
  readonly kind = "confidence-ribbon" as const;
  readonly id: string;

  constructor(private readonly options: ConfidenceRibbonLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { samples, color = DEFAULT_COLOR, opacity = 0.18, style = SmoothStyle } = this.options;
    if (samples.length < 2) return;
    if (samples.some((s) => !Number.isFinite(s.lower) || !Number.isFinite(s.upper))) return;

    const upper = samples.map((s) => ({ x: ctx.xScale(s.exposure), y: ctx.yScale(s.upper) }));
    const lower = samples.map((s) => ({ x: ctx.xScale(s.exposure), y: ctx.yScale(s.lower) }));
    const d = buildBandPath(upper, lower, style);
    if (!d) return;

    ctx.target.group({ class: `er-confidence-ribbon ${this.id}` }, () => {
      ctx.target.drawArea(d, { fill: color, opacity, stroke: "none" });
    });
  }
}
