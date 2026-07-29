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
 * Layer renders. Not yet collision-resolved: Phase 3 ports the marker-layout algorithm that
 * turns these into positioned labels; until then `RenderResult.metadata.markers` is exactly
 * what Layers pushed, in render order, with no overlap avoidance.
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
    markers: MarkerCandidate[];
    hitRegions: HitRegion[];
  };
}

export interface Renderer {
  render(input: RenderInput): RenderResult;
}
