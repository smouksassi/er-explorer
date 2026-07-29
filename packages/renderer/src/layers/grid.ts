import { tickPositions } from "../ticks";
import type { DrawContext, Layer } from "../types";

export interface GridLayerOptions {
  id: string;
  xTickValues?: number[];
  xTickCount?: number;
  yTickValues?: number[];
  yTickCount?: number;
  color?: string;
}

const DEFAULT_GRID_COLOR = "#edf1f7";

/** Ports the grid-drawing portion of `renderLogisticScatterChart`/`renderLinearScatterChart` -
 * shares its default tick counts (7 on x, 5 on y) with `AxisLayer` so the two agree by default,
 * without either depending on the other. */
export class GridLayer implements Layer {
  readonly kind = "grid" as const;
  readonly id: string;

  constructor(private readonly options: GridLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { plotRect, xScale, yScale, target } = ctx;
    const color = this.options.color ?? DEFAULT_GRID_COLOR;
    const xTicks = this.options.xTickValues ?? tickPositions(xScale.domain, this.options.xTickCount ?? 7);
    const yTicks = this.options.yTickValues ?? tickPositions(yScale.domain, this.options.yTickCount ?? 5);

    target.group({ class: `er-grid ${this.id}` }, () => {
      for (const value of xTicks) {
        const xx = xScale(value);
        target.drawLine(
          [
            { x: xx, y: plotRect.y },
            { x: xx, y: plotRect.y + plotRect.height }
          ],
          { stroke: color }
        );
      }
      for (const value of yTicks) {
        const yy = yScale(value);
        target.drawLine(
          [
            { x: plotRect.x, y: yy },
            { x: plotRect.x + plotRect.width, y: yy }
          ],
          { stroke: color }
        );
      }
    });
  }
}
