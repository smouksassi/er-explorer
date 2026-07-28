import type { ModelFamily } from "@er-explorer/domain";
import type { ConfidenceInterval, ConfidenceIntervalMethod, ConfidenceIntervalRequest } from "./confidenceInterval";
import type { Diagnostic } from "./diagnostic";
import type { PredictionSurface } from "./predictionSurface";

/**
 * The data a model fit is performed against - exposures, observed
 * responses, and optionally covariates/weights - kept as plain arrays
 * rather than referencing `@er-explorer/data`'s `LoadedDataset` directly,
 * so a plugin can be handed exactly the columns it needs regardless of
 * where they came from.
 *
 * `responses`' meaning depends on the model family answering the request:
 * 0/1 for a logistic fit, a continuous score for a linear fit, a
 * covariate-coded ordinal level for an ordinal fit, and so on -
 * `packages/analysis` doesn't interpret them itself.
 */
export interface FitRequest {
  exposures: number[];
  responses: Array<number | string>;
  /** Covariate values, column-oriented (one array per covariate id), aligned by index with `exposures`/`responses`. */
  covariates?: Record<string, Array<number | string>>;
  /** Per-observation weights, aligned by index with `exposures`/`responses`, for models that support weighted fitting. */
  weights?: number[];
  /** Id of the censoring-indicator covariate, for time-to-event families (Cox, Kaplan-Meier). */
  censoringVariableId?: string;
  /** Free-form fitting options a specific plugin understands (ridge penalty, iteration caps, ...). */
  options?: Record<string, number | string | boolean>;
}

/**
 * How a model's parameters were arrived at - the "Future Optimization"
 * responsibility of this package: today's logistic fit uses Newton-Raphson
 * IRLS, but an Emax fit might use nonlinear least squares, an ordinal fit
 * might use an EM algorithm, and so on. Kept generic so `FitOutcome` can
 * report whichever algorithm a plugin actually used without this package
 * needing to know about it in advance.
 */
export interface OptimizationSummary {
  /** Name of the optimization algorithm used (e.g. `"newton-raphson-irls"`, `"nonlinear-least-squares"`, `"em"`). */
  algorithm?: string;
  converged: boolean;
  iterations?: number;
  /** Objective value at the fitted solution (e.g. log-likelihood, deviance, sum of squared residuals) - meaning depends on the algorithm. */
  objectiveValue?: number;
  warnings?: string[];
}

/** The result of fitting an {@link AnalysisModel}: its parameters (opaque to this package, meaningful only to the plugin that produced and consumes them) plus how the fit was obtained. */
export interface FitOutcome<TParams = unknown> {
  params: TParams;
  optimization: OptimizationSummary;
}

/** Optional conditions to evaluate a {@link PredictionSurface} under, for a model that supports covariate adjustment (e.g. predicting at a reference covariate level rather than marginally). */
export interface PredictionContext {
  covariateValues?: Record<string, number | string>;
}

/**
 * What an {@link AnalysisModel} plugin supports, so a registry or caller
 * can check capability without invoking a method (e.g. "does this model
 * support a bootstrap CI?" without attempting one).
 */
export interface AnalysisModelCapabilities {
  confidenceIntervalMethods: ConfidenceIntervalMethod[];
  supportsCovariateAdjustment: boolean;
  /** Whether this model family requires a censoring-indicator variable (true for Cox/Kaplan-Meier). */
  requiresCensoringVariable: boolean;
}

/**
 * The plugin contract every exposure-response model implements - the
 * central interface of `packages/analysis`'s plugin architecture. Model
 * Registry, Prediction API, Diagnostics, Bootstrap, and Wald CI are all
 * facets of this one contract: `fit` produces parameters via some
 * {@link OptimizationSummary}, `predict` turns parameters into a
 * queryable {@link PredictionSurface}, `diagnose` reports
 * {@link Diagnostic}s, and `confidenceInterval` reports
 * {@link ConfidenceInterval}s by whichever {@link ConfidenceIntervalMethod}
 * is requested.
 *
 * This is a pure interface - "no logistic implementation" means
 * `packages/analysis` ships no object that implements `AnalysisModel` for
 * any family. A concrete logistic/linear/Emax/... plugin is future work,
 * registered with a {@link ModelRegistry} once it exists; statistics are
 * an implementation detail of that future plugin, not of this package.
 */
export interface AnalysisModel<TParams = unknown> {
  /** Stable identifier for this plugin (e.g. `"logistic-irls-v1"`), distinct from `family` since more than one plugin could implement the same family (e.g. two different Emax parameterizations). */
  readonly id: string;
  /** Which `@er-explorer/domain` `ModelFamily` this plugin implements. */
  readonly family: ModelFamily;
  /** Human-readable label (e.g. `"Logistic regression (Newton-Raphson IRLS)"`). */
  readonly label: string;
  readonly description?: string;
  readonly capabilities: AnalysisModelCapabilities;

  fit(request: FitRequest): FitOutcome<TParams>;
  predict(params: TParams, context?: PredictionContext): PredictionSurface;
  diagnose(params: TParams, request: FitRequest): Diagnostic[];
  /**
   * Compute confidence intervals for a fitted model. Takes the original
   * `FitRequest` alongside `params` - not just `params` - because a
   * resampling method (`"bootstrap"`) needs the raw (exposure, response)
   * pairs to resample from; an analytic method (`"wald"`) can ignore it and
   * use `params`'s own covariance/standard-error information instead.
   */
  confidenceInterval(params: TParams, fitRequest: FitRequest, request: ConfidenceIntervalRequest): ConfidenceInterval[];
}
