/**
 * `@er-explorer/model-linear` - the first concrete `@er-explorer/analysis`
 * `AnalysisModel` plugin: single-predictor ordinary least squares for
 * continuous exposure-response endpoints.
 *
 * - `ols.ts` - `fitLinearModel`, the closed-form OLS fit, and its
 *   `LinearParams`/`LinearCovariance` result shape.
 * - `confidenceIntervals.ts` - `waldLinearConfidenceIntervals` (analytic,
 *   via a t-distribution approximation) and
 *   `bootstrapLinearConfidenceIntervals` (seeded case-resampling),
 *   implementing the plugin's `"wald"`/`"bootstrap"` confidence interval
 *   methods.
 * - `statistics.ts` - `meanConfidenceInterval`, the continuous-endpoint
 *   counterpart of a Wilson score interval: a group's observed mean, CI,
 *   and n - there is no responder/non-responder rate for a continuous
 *   endpoint.
 * - `prng.ts` - a small seeded PRNG and percentile helper the bootstrap
 *   uses, self-contained rather than reused from another package/plugin.
 * - `plugin.ts` - `linearAnalysisModel`, the actual `AnalysisModel`
 *   instance a `ModelRegistry` (see `@er-explorer/analysis`) can register.
 *
 * No React, no D3, no UI.
 */

export { type LinearCovariance, type LinearParams, fitLinearModel } from "./ols";

export {
  type BootstrapLinearOptions,
  waldLinearConfidenceIntervals,
  bootstrapLinearConfidenceIntervals
} from "./confidenceIntervals";

export { type MeanConfidenceInterval, zForLevel, tQuantile, meanConfidenceInterval } from "./statistics";

export { createSeededRandom, quantile } from "./prng";

export { LINEAR_ANALYSIS_MODEL_ID, linearAnalysisModel } from "./plugin";
