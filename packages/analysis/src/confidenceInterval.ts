import type { BootstrapConfig, CIMethod } from "@er-explorer/domain";

/**
 * How a {@link ConfidenceInterval} was computed. Includes
 * `@er-explorer/domain`'s closed `CIMethod` (`"wald"`/`"bootstrap"`/`"none"`)
 * so existing Question/Prediction data stays compatible, widened to accept
 * any other plugin-defined method name - "Design for plugins" means a
 * future model (e.g. a Bayesian Emax fit reporting a credible interval, or
 * a profile-likelihood interval) isn't limited to the two methods known
 * today.
 */
export type ConfidenceIntervalMethod = CIMethod | (string & {});

/**
 * A request to compute confidence intervals at a set of exposures - the
 * "Bootstrap" and "Wald CI" responsibilities of this package, unified into
 * one request shape rather than two separate ones, since which fields
 * apply depends only on `method`.
 */
export interface ConfidenceIntervalRequest {
  exposures: number[];
  method: ConfidenceIntervalMethod;
  /** Confidence level, e.g. `0.95`. Defaults are left to the plugin. */
  level?: number;
  /** Bootstrap resamples/seed/level, relevant only when `method` is `"bootstrap"` (see `@er-explorer/domain`'s `BootstrapConfig` - the same shape `Question.bootstrapConfig` uses, so a saved seed reproduces the same interval). */
  bootstrap?: BootstrapConfig;
}

/**
 * One confidence interval result, at one exposure, from one method - the
 * fitted-uncertainty counterpart of a {@link PredictionSurfacePoint}.
 *
 * Kept separate from `PredictionSurfacePoint` (rather than folding
 * lower/upper onto it) because a caller may request several CI methods for
 * the same fitted model to compare them (e.g. Wald vs. bootstrap at the
 * same exposures), which wouldn't fit a single point's shape.
 */
export interface ConfidenceInterval {
  exposure: number;
  method: ConfidenceIntervalMethod;
  level: number;
  lower: number;
  upper: number;
  /** Id of the endpoint this interval belongs to, when a request spans more than one endpoint. */
  endpointId?: string;
}
