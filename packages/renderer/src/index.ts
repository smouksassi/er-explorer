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
 * Phase 2: `CurveSample`, the `Fit`/`ConfidenceRibbon` layers, and the pluggable `CurveStyle`
 * (`SmoothStyle`/`StepStyle`) they share - the same "shared data, swappable draw strategy"
 * pattern `Distribution` will use for Boxplot/Violin/Lineranges in Phase 6.
 *
 * Phase 3: the `ObservedStat`/`Annotation` layers, and the marker-resolution system
 * (`resolveMarkers`/`renderLaidOutMarker`) the Renderer runs exactly once, after every Layer has
 * rendered, so markers from different Layers never overlap each other.
 *
 * Phase 4 (this file's current contents, additionally): `DoseProjectionLayer` (the geometric
 * half of a dose-click projection - Q1-Q3 shading, guide lines, dots, read off an already-fitted
 * curve's own samples) and a small `FillStyle.attrs`/`ScatterPointDatum.data` passthrough for
 * `data-*` attributes, kept only until an `InteractionController` (Phase 5) replaces today's
 * DOM-query-based interactivity with `HitRegion`s. This is the phase where `apps/demo` first
 * consumes this package (the linear/continuous scatter chart call site); `Distribution`
 * (Phase 6) and the logistic/binary cutover (Phase 5) follow later.
 */

export type {
  DrawContext,
  DrawTarget,
  FillStyle,
  HitRegion,
  LaidOutMarker,
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
export { interpolateCurveSample } from "./curveSample";
export { SmoothStyle, StepStyle, buildBandPath } from "./curveStyle";
export type { CurveStyle } from "./curveStyle";
export { resolveMarkers, renderLaidOutMarker } from "./markers";

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
export { ObservedStatLayer } from "./layers/observedStat";
export type { ObservedStatBin, ObservedStatLayerOptions } from "./layers/observedStat";
export { AnnotationLayer } from "./layers/annotation";
export type { AnnotationLayerOptions, ReferenceLineSpec } from "./layers/annotation";
export { DoseProjectionLayer } from "./layers/doseProjection";
export type { DoseProjectionGroup, DoseProjectionLayerOptions } from "./layers/doseProjection";

/** Package identity marker (kept from Phase 0 for continuity). */
export const RENDERER_PACKAGE_ID = "@er-explorer/renderer" as const;
