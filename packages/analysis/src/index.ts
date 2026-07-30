/**
 * `@er-explorer/analysis` - the analysis engine for ER Explorer (formerly
 * `packages/statistical-engine`).
 *
 * Statistics become implementation details: this package defines the
 * plugin contract every exposure-response model implements
 * ({@link AnalysisModel}), how fitted models are queried
 * ({@link PredictionSurface}, {@link ConfidenceInterval}), how they report
 * their health ({@link Diagnostic}), and how they're discovered
 * ({@link ModelRegistry}) - not any particular model's math. No concrete
 * model is implemented here; that is deliberately future work, one plugin
 * per model family (Logistic, Linear, Emax, Ordinal, Kaplan-Meier, Cox,
 * Clinical Utility), registered against a `ModelRegistry`.
 *
 * - `analysisModel.ts` - `AnalysisModel`, the central plugin contract
 *   (fit/predict/diagnose/confidenceInterval), plus `FitRequest`,
 *   `FitOutcome`, `OptimizationSummary` ("Future Optimization" - which
 *   algorithm a plugin used to fit its parameters), and
 *   `AnalysisModelCapabilities`.
 * - `predictionSurface.ts` - `PredictionSurface`, a fitted relationship
 *   evaluable at any exposure, on demand (the "Prediction API").
 * - `diagnostic.ts` - `Diagnostic`, one health/fit-quality finding.
 * - `confidenceInterval.ts` - `ConfidenceInterval` and
 *   `ConfidenceIntervalRequest`, covering both the "Wald CI" and
 *   "Bootstrap" responsibilities via one open-ended `method`.
 * - `modelRegistry.ts` - `ModelRegistry`, the "Model Registry"
 *   responsibility: register/look up/list plugins by id or family.
 * - `sampleCurve.ts` - `sampleCurve()`, a small non-computational helper that merges a
 *   `PredictionSurface`'s estimates with a `confidenceInterval()` call's output into the
 *   `PredictionPoint[]` shape `@er-explorer/renderer`'s `CurveSample` aliases (ADR-0009). This
 *   is alignment, not statistics - it never fits a model or derives a CI itself.
 *
 * No React, no D3, no UI, and - for this new surface - no implementation:
 * every export above is a type or interface (except `sampleCurve`, which is a pure
 * data-reconciliation function, not a statistical one).
 *
 * `legacyStatistics.ts` preserves the original concrete logistic
 * implementation (Newton-Raphson IRLS fitting, Wald/bootstrap CIs,
 * distribution summaries, KDE) unchanged, purely for backward
 * compatibility with `apps/demo`, `packages/visualization-engine`, and
 * `packages/session-engine`, none of which have migrated to the plugin
 * architecture above yet. It is not part of, and is not registered
 * against, the new `AnalysisModel`/`ModelRegistry` contracts.
 */

export {
  type FitRequest,
  type OptimizationSummary,
  type FitOutcome,
  type PredictionContext,
  type AnalysisModelCapabilities,
  type AnalysisModel
} from "./analysisModel";

export { type PredictionSurfacePoint, type PredictionSurfaceScale, type PredictionSurface } from "./predictionSurface";

export { type DiagnosticSeverity, type Diagnostic } from "./diagnostic";

export {
  type ConfidenceIntervalMethod,
  type ConfidenceIntervalRequest,
  type ConfidenceInterval
} from "./confidenceInterval";

export { type ModelRegistry } from "./modelRegistry";

export { type SampleCurveOptions, sampleCurve } from "./sampleCurve";

export {
  type ModelKind,
  type ModelDefinition,
  type FitResult,
  type PredictionRequest,
  type PredictionResult,
  createModelDefinition,
  createPredictionRequest,
  type LogisticCovariance,
  type LogisticModel,
  type FitLogisticOptions,
  sigmoid,
  fitLogisticModel,
  toFitResult,
  type PointEstimate,
  predictLogisticWald,
  predictLogisticWaldResult,
  createSeededRandom,
  type BootstrapOptions,
  bootstrapLogisticCI,
  quantile,
  type ProportionCI,
  wilsonScoreInterval,
  type DistributionSummary,
  summarizeDistribution,
  silvermanBandwidth,
  kernelDensityEstimate
} from "./legacyStatistics";
