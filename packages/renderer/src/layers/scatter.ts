import type { DrawContext, Layer } from "../types";

export interface ScatterPointDatum {
  id: string | number;
  x: number;
  y: number;
  color?: string;
  radius?: number;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  label?: string;
}

export interface ScatterLayerOptions {
  id: string;
  points: ScatterPointDatum[];
  defaultColor?: string;
  defaultRadius?: number;
  defaultOpacity?: number;
  /** Register an inert hit-region per point (docs/RENDERER_ARCHITECTURE.md §3/§5/§6). Off by
   * default - nothing consumes hit-regions yet; `InteractionController` arrives in Phase 5. */
  registerHitRegions?: boolean;
}

const DEFAULT_COLOR = "#64748b";

/** Ports the point-drawing portion of `renderLogisticScatterChart`/`renderLinearScatterChart`.
 * Deliberately generic (`x`/`y` in domain units, not "exposure"/"response") so this Layer works
 * unchanged for any endpoint type per docs/RENDERER_ARCHITECTURE.md §7. */
export class ScatterLayer implements Layer {
  readonly kind = "scatter" as const;
  readonly id: string;

  constructor(private readonly options: ScatterLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { xScale, yScale, target, interactions } = ctx;
    const { points, defaultColor = DEFAULT_COLOR, defaultRadius = 3.1, defaultOpacity = 0.6, registerHitRegions } = this.options;

    target.group({ class: `er-points ${this.id}` }, () => {
      for (const p of points) {
        const cx = xScale(p.x);
        const cy = yScale(p.y);
        const radius = p.radius ?? defaultRadius;
        target.drawCircle(cx, cy, radius, {
          fill: p.color ?? defaultColor,
          opacity: p.opacity ?? defaultOpacity,
          stroke: p.stroke,
          strokeWidth: p.strokeWidth
        });
        if (registerHitRegions) {
          interactions?.add({
            id: `${this.id}:${p.id}`,
            layerId: this.id,
            shape: { type: "circle", cx, cy, r: radius + 2 },
            data: { pointId: p.id, x: p.x, y: p.y, label: p.label }
          });
        }
      }
    });
  }
}
