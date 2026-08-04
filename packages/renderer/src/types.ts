export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Scale {
  (value: number): number;
  invert(pixel: number): number;
  readonly domain: [number, number];
  readonly range: [number, number];
}

export interface LineStyle {
  stroke: string;
  strokeWidth?: number;
  dash?: string;
  opacity?: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
}

export interface FillStyle {
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
  /** Stroke dash pattern (e.g. `"7 5"`), relevant only when `stroke` is set - used by `Fit`'s
   * dashed default curve style. Unused by Phase 1's Axis/Grid/Scatter. */
  dash?: string;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  /**
   * Arbitrary extra SVG attributes to merge onto the drawn element (e.g. `data-id`/
   * `data-exposure` for a scatter point) - a stopgap for DOM-query-based interactivity that
   * predates the `HitRegion` system, kept only until an `InteractionController` (Phase 5)
   * replaces that querying with `RenderResult.metadata.hitRegions` instead.
   */
  attrs?: Record<string, string | number>;
  /**
   * Optional native SVG `<title>` child - a browser-native tooltip fallback, independent of any
   * custom JS tooltip a caller might also attach. Needed for views with no custom interactivity
   * at all (e.g. "Compare Endpoints", which deliberately skips hover/brush wiring - see
   * `apps/demo`), where this is the only hover feedback a scatter point gets.
   */
  title?: string;
}

export interface TextStyle {
  fill?: string;
  fontSize?: number;
  fontWeight?: number;
  textAnchor?: "start" | "middle" | "end";
  transform?: string;
  opacity?: number;
}

/**
 * A curve-adjacent marker candidate a Layer wants drawn (an observed-rate readout, a
 * reference-line fit value, a censoring tick, ...) - pushed via `ctx.markers.add()` while a
 * Layer renders. All coordinates are pixel space (already run through `ctx.xScale`/`ctx.yScale`
 * by the pushing Layer), matching `HitRegion`'s convention. `yLow`/`yHigh` are the marker's
 * error-bar bounds (also pixel space) - omit both for a marker with no CI to show.
 *
 * Not yet collision-resolved at push time: the Renderer calls `resolveMarkers()` exactly once,
 * after every Layer has rendered, turning the full set into `LaidOutMarker[]` - this is what
 * preserves whole-chart collision avoidance without any Layer needing to know about any other
 * Layer's markers.
 */
export interface MarkerCandidate {
  id: string;
  ownerLayerId: string;
  x: number;
  y: number;
  yLow?: number;
  yHigh?: number;
  color: string;
  lines: string[];
  kind: string;
  /** Optional dash for label box border (e.g. endpoint line style in compare overlay). */
  strokeDash?: string;
}

/** A `MarkerCandidate` after collision-avoidant layout - `labelTop` is the resolved pixel y for
 * the top of its label box. This is the shape `RenderResult.metadata.markers` carries. */
export interface LaidOutMarker extends MarkerCandidate {
  labelTop: number;
}

export interface HitRegion {
  id: string;
  layerId: string;
  shape:
    | { type: "rect"; rect: PixelRect }
    | { type: "circle"; cx: number; cy: number; r: number }
    | { type: "path"; d: string };
  data?: unknown;
  cursor?: string;
}

export interface DrawTarget {
  drawLine(points: Array<{ x: number; y: number }>, style: LineStyle): void;
  drawArea(pathD: string, style: FillStyle): void;
  drawRect(rect: PixelRect, style: FillStyle): void;
  drawCircle(cx: number, cy: number, r: number, style: FillStyle): void;
  drawText(x: number, y: number, text: string, style: TextStyle): void;
  group(attrs: Record<string, string>, fn: () => void): void;
}

export interface DrawContext {
  readonly width: number;
  readonly height: number;
  readonly margin: { top: number; right: number; bottom: number; left: number };
  readonly plotRect: PixelRect;
  readonly xScale: Scale;
  readonly yScale: Scale;
  readonly markers: { add(candidate: MarkerCandidate): void };
  readonly interactions?: { add(region: HitRegion): void };
  /**
   * A generic, per-layer-id escape hatch for caller-consumable data that is neither a
   * `MarkerCandidate` nor a `HitRegion` - e.g. `DistributionLayer`'s resolved per-group shape
   * geometry (pixel `cy`, `xSamples`, box/density half-heights), which `apps/demo`'s own
   * boxplot<->violin morph animation reads back out of `RenderResult.metadata.layerData` and
   * re-interpolates frame by frame, entirely outside any Layer's `render()`. Keyed by the
   * pushing Layer's own `id` (a Layer only ever sets its own key, once, at the end of its
   * `render()`) - unlike markers/hit-regions, this data is never resolved or transformed by the
   * Renderer, just handed back as-is.
   */
  readonly layerData: { set(layerId: string, data: unknown): void };
  readonly target: DrawTarget;
}

export type LayerKind =
  | "axis"
  | "grid"
  | "scatter"
  | "fit"
  | "confidence-ribbon"
  | "observed-stat"
  | "distribution"
  | "annotation";

export interface Layer {
  readonly id: string;
  readonly kind: LayerKind;
  /**
   * Escape hatch only (docs/RENDERER_ARCHITECTURE.md §6) - the Renderer owns paint order via a
   * fixed per-kind rank table. Set this only when a caller genuinely needs to deviate from that
   * table (e.g. painting one specific annotation behind a curve instead of in front of it).
   */
  readonly zIndex?: number;
  render(ctx: DrawContext): void;
}

export interface RenderInput {
  width: number;
  height: number;
  margin?: Partial<{ top: number; right: number; bottom: number; left: number }>;
  xDomain: [number, number];
  yDomain: [number, number];
  layers: Layer[];
}

export interface RenderResult {
  outputType: "svg" | "canvas";
  content: string | unknown;
  metadata: {
    plotRect: PixelRect;
    xScale: Scale;
    yScale: Scale;
    markers: LaidOutMarker[];
    hitRegions: HitRegion[];
    /** Every Layer's `ctx.layerData` contribution, keyed by that Layer's own `id`. */
    layerData: Record<string, unknown>;
  };
}

export interface Renderer {
  render(input: RenderInput): RenderResult;
}
