import { formatTickValue, tickPositions } from "../ticks";
import type { DrawContext, Layer } from "../types";

export interface AxisLayerOptions {
  id: string;
  orientation: "x" | "y";
  /** Explicit tick values, e.g. a fixed [0, 1] for a probability axis. Overrides `tickCount`. */
  tickValues?: number[];
  /** Number of evenly-spaced ticks across the scale's domain. Defaults to 7 for "x" (matching
   * the current renderer's 6-division x-axis) and 5 for "y" (matching its `niceYTicks`). */
  tickCount?: number;
  format?: (value: number) => string;
  label?: string;
  color?: string;
  labelColor?: string;
  fontSize?: number;
}

const DEFAULT_AXIS_COLOR = "#94a3b8";
const DEFAULT_LABEL_COLOR = "#334155";
const DEFAULT_TICK_LABEL_COLOR = "#667085";

/** Ports the axis-drawing portion of `renderLogisticScatterChart`/`renderLinearScatterChart`
 * into a standalone Layer - one instance per axis (construct two: orientation "x" and "y"). */
export class AxisLayer implements Layer {
  readonly kind = "axis" as const;
  readonly id: string;

  constructor(private readonly options: AxisLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    if (this.options.orientation === "x") this.renderX(ctx);
    else this.renderY(ctx);
  }

  private ticks(domain: [number, number], defaultCount: number): number[] {
    return this.options.tickValues ?? tickPositions(domain, this.options.tickCount ?? defaultCount);
  }

  private renderX(ctx: DrawContext): void {
    const { plotRect, xScale, target } = ctx;
    const format = this.options.format ?? formatTickValue;
    const color = this.options.color ?? DEFAULT_AXIS_COLOR;
    const bottom = plotRect.y + plotRect.height;

    target.group({ class: `er-axis er-axis-x ${this.id}` }, () => {
      target.drawLine(
        [
          { x: plotRect.x, y: bottom },
          { x: plotRect.x + plotRect.width, y: bottom }
        ],
        { stroke: color }
      );
      for (const value of this.ticks(xScale.domain, 7)) {
        const xx = xScale(value);
        target.drawLine(
          [
            { x: xx, y: bottom },
            { x: xx, y: bottom + 6 }
          ],
          { stroke: color }
        );
        target.drawText(xx, bottom + 22, format(value), {
          textAnchor: "middle",
          fill: this.options.labelColor ?? DEFAULT_TICK_LABEL_COLOR,
          fontSize: this.options.fontSize ?? 12
        });
      }
      if (this.options.label) {
        target.drawText(plotRect.x + plotRect.width / 2, bottom + 40, this.options.label, {
          textAnchor: "middle",
          fill: DEFAULT_LABEL_COLOR,
          fontSize: 13,
          fontWeight: 700
        });
      }
    });
  }

  private renderY(ctx: DrawContext): void {
    const { plotRect, yScale, target } = ctx;
    const format = this.options.format ?? formatTickValue;
    const color = this.options.color ?? DEFAULT_AXIS_COLOR;
    const left = plotRect.x;

    target.group({ class: `er-axis er-axis-y ${this.id}` }, () => {
      target.drawLine(
        [
          { x: left, y: plotRect.y },
          { x: left, y: plotRect.y + plotRect.height }
        ],
        { stroke: color }
      );
      for (const value of this.ticks(yScale.domain, 5)) {
        const yy = yScale(value);
        target.drawLine(
          [
            { x: left - 6, y: yy },
            { x: left, y: yy }
          ],
          { stroke: color }
        );
        target.drawText(left - 10, yy + 4, format(value), {
          textAnchor: "end",
          fill: this.options.labelColor ?? DEFAULT_TICK_LABEL_COLOR,
          fontSize: this.options.fontSize ?? 12
        });
      }
      if (this.options.label) {
        const midY = plotRect.y + plotRect.height / 2;
        target.drawText(18, midY, this.options.label, {
          textAnchor: "middle",
          fill: DEFAULT_LABEL_COLOR,
          fontSize: 13,
          fontWeight: 700,
          transform: `rotate(-90 18 ${midY})`
        });
      }
    });
  }
}
