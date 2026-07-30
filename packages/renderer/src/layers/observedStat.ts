import type { DrawContext, Layer } from "../types";

/**
 * One observed (non-model) readout at a bin of the active exposure split - a proportion+CI, a
 * mean+CI, or anything else on the same generic shape (docs/RENDERER_ARCHITECTURE.md §3). The
 * renderer never needs to know which: `primaryLabel`/`secondaryLabel` are pre-formatted by the
 * caller (e.g. `"74%"` / `"12/34"` for a responder rate, `"23.4"` / `"n=41"` for a mean), and
 * default to a plain formatting of `center`/`n` when omitted so a caller can opt out of
 * formatting entirely for a quick readout.
 */
export interface ObservedStatBin {
  x: number;
  center: number;
  lower: number;
  upper: number;
  n: number;
  primaryLabel?: string;
  secondaryLabel?: string;
  /** Overrides the marker's default color - used to match a dose/endpoint/group. */
  color?: string;
}

export interface ObservedStatLayerOptions {
  id: string;
  bins: ObservedStatBin[];
  defaultColor?: string;
}

const DEFAULT_COLOR = "#0f172a";

/**
 * Draws no geometry itself - an `ObservedStatBin` only ever becomes a `MarkerCandidate` pushed
 * into the shared draw context (docs/RENDERER_ARCHITECTURE.md §5/§6). The Renderer resolves and
 * paints every Layer's markers together, exactly once, after all layers have rendered - so an
 * `ObservedStat` marker and another Layer's marker (e.g. `AnnotationLayer`'s optional
 * fit-value marker) competing for the same x-region get de-collided jointly.
 */
export class ObservedStatLayer implements Layer {
  readonly kind = "observed-stat" as const;
  readonly id: string;

  constructor(private readonly options: ObservedStatLayerOptions) {
    this.id = options.id;
  }

  render(ctx: DrawContext): void {
    const { bins, defaultColor = DEFAULT_COLOR } = this.options;
    bins.forEach((bin, index) => {
      const primary = bin.primaryLabel ?? formatDefault(bin.center);
      const secondary = bin.secondaryLabel ?? `n=${bin.n}`;
      ctx.markers.add({
        id: `${this.id}:${index}`,
        ownerLayerId: this.id,
        x: ctx.xScale(bin.x),
        y: ctx.yScale(bin.center),
        yLow: ctx.yScale(bin.lower),
        yHigh: ctx.yScale(bin.upper),
        color: bin.color ?? defaultColor,
        lines: [primary, secondary],
        kind: "observed-stat"
      });
    });
  }
}

function formatDefault(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
