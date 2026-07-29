/**
 * @er-explorer/renderer - framework-agnostic rendering engine.
 *
 * Realizes ADR-0009 (see docs/DECISIONS.md once accepted, and
 * docs/RENDERER_ARCHITECTURE.md for the full design): a `Renderer` composes
 * an ordered list of `Layer`s (Axis, Grid, Scatter, Fit, ConfidenceRibbon,
 * ObservedStat, Distribution, Annotation) against a shared draw context.
 * `SVGRenderer` is the concrete SVG implementation (ADR-0003); `CanvasRenderer`
 * is an intentionally unimplemented placeholder for a future non-SVG target.
 *
 * Dependency rule: this package imports from `@er-explorer/domain` only -
 * never `@er-explorer/analysis`, never React. Layers consume plain domain
 * vocabulary (`CurveSample`, an alias of `@er-explorer/domain`'s
 * `PredictionPoint`), not analysis-layer contracts like `PredictionSurface`.
 * Reconciling a live model's `PredictionSurface` + `ConfidenceInterval[]`
 * into a `CurveSample[]` is not this package's job (see `sampleCurve()` in
 * `@er-explorer/analysis`, added alongside this package's Phase 2).
 *
 * This file is a Phase 0 placeholder (see docs/RENDERER_ARCHITECTURE.md §8):
 * it exists to prove the package scaffold (package.json/tsconfig/vitest)
 * builds and typechecks cleanly before any real Layer/Renderer code is
 * written. Phase 1 replaces this with Scale/DrawContext/SVGRenderer and the
 * Axis/Grid/Scatter layers.
 */

/** Package identity marker - real exports begin in Phase 1. */
export const RENDERER_PACKAGE_ID = "@er-explorer/renderer" as const;
