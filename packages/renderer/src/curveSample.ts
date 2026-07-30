import type { PredictionPoint } from "@er-explorer/domain";

/**
 * The renderer's curve input type - a plain alias of `@er-explorer/domain`'s `PredictionPoint`,
 * not a new nominal type (docs/RENDERER_ARCHITECTURE.md sections 1-2). The same shape a
 * persisted, session-replayed `Prediction.points` already uses (ADR-0004), so a live-sampled
 * curve and a replayed session converge on one render path.
 *
 * Reconciling a live `AnalysisModel`'s `PredictionSurface` (point estimates only - deliberately
 * no CI) with its `confidenceInterval()` output (a separate concept, so several CI methods can
 * be requested/compared) into a `CurveSample[]` is `@er-explorer/analysis`'s `sampleCurve()`
 * helper, not this package's job - `packages/renderer` never imports `@er-explorer/analysis`.
 */
export type CurveSample = PredictionPoint;
