/**
 * @er-explorer/renderer - framework-agnostic rendering engine.
 *
 * Realizes ADR-0009 (see docs/DECISIONS.md once accepted, and docs/RENDERER_ARCHITECTURE.md for
 * the full design): a `Renderer` composes an ordered list of `Layer`s (Axis, Grid, Scatter, Fit,
 * ConfidenceRibbon, ObservedStat, Distribution, Annotation) against a shared draw context.
 * `SVGRenderer` is the concrete SVG implementation (ADR-0003); `CanvasRenderer` is an
 * intentionally unimplemented placeholder for a future non-SVG target.
 *
 * Dependency rule: this package imports from `@er-explorer/domain` only - never
 * `@er-explorer/analysis`, never React. Layers consume plain domain vocabulary (`CurveSample`,
 * an alias of `@er-explorer/domain`'s `PredictionPoint`), not analysis-layer contracts like
 * `PredictionSurface`. Reconciling a live model's `PredictionSurface` + `ConfidenceInterval[]`
 * into a `CurveSample[]` is `@er-explorer/analysis`'s `sampleCurve()` helper, not this package's
 * job.
 *
 * Phase 1: core primitives (`Scale`, `DrawTarget`/`DrawContext`, the marker/hit-region
 * collectors, `SVGRenderer` with its fixed rank-based paint order) plus the `Axis`/`Grid`/
 * `Scatter` layers.
 *
 * Phase 2 (this file's current contents, additionally): `CurveSample`, the `Fit`/
 * `ConfidenceRibbon` layers, and the pluggable `CurveStyle` (`SmoothStyle`/`StepStyle`) they
 * share - the same "shared data, swappable draw strategy" pattern `Distribution` will use for
 * Boxplot/Violin/Lineranges in Phase 6.
 *
 * `ObservedStat`/`Annotation` (Phase 3) and `Distribution` (Phase 6) follow in later phases;
 * `apps/demo` does not consume this package yet (Phase 4+).
 */

export type {
  DrawContext,
  DrawTarget,
  FillStyle,
  HitRegion,
  Layer,
  LayerKind,
  LineStyle,
  MarkerCandidate,
  PixelRect,
  Renderer,
  RenderInput,
  RenderResult,
  Scale,
  TextStyle
} from "./types";

export { scaleLinear } from "./scale";
export { tickPositions, formatTickValue } from "./ticks";

export type { CurveSample } from "./curveSample";
export { SmoothStyle, StepStyle, buildBandPath } from "./curveStyle";
export type { CurveStyle } from "./curveStyle";

export { SvgDrawTarget } from "./svgDrawTarget";
export { SVGRenderer } from "./svgRenderer";
export { CanvasRenderer } from "./canvasRenderer";

export { AxisLayer } from "./layers/axis";
export type { AxisLayerOptions } from "./layers/axis";
export { GridLayer } from "./layers/grid";
export type { GridLayerOptions } from "./layers/grid";
export { ScatterLayer } from "./layers/scatter";
export type { ScatterLayerOptions, ScatterPointDatum } from "./layers/scatter";
export { FitLayer } from "./layers/fit";
export type { FitLayerOptions } from "./layers/fit";
export { ConfidenceRibbonLayer } from "./layers/confidenceRibbon";
export type { ConfidenceRibbonLayerOptions } from "./layers/confidenceRibbon";

/** Package identity marker (kept from Phase 0 for continuity). */
export const RENDERER_PACKAGE_ID = "@er-explorer/renderer" as const;
