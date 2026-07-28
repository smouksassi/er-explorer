/** One evaluated point of a {@link PredictionSurface}. */
export interface PredictionSurfacePoint {
  /** Exposure value this estimate is evaluated at, on the exposure metric's original (untransformed) scale. */
  exposure: number;
  /** Point estimate, on whichever scale the owning `PredictionSurface.scale` declares. */
  estimate: number;
  /** Id of the endpoint this estimate belongs to, when a surface spans more than one endpoint (e.g. a Compare Endpoints-style multi-endpoint prediction). */
  endpointId?: string;
}

/**
 * The scale a {@link PredictionSurface}'s estimates are reported on:
 * `"response"` is the outcome's own natural scale (e.g. a probability for a
 * binary endpoint, a hazard ratio for Cox, a raw score for a continuous
 * endpoint); `"linear-predictor"` is the model's internal linear scale
 * before whatever link function maps it to the response scale (e.g. the
 * log-odds a logistic model computes before applying the sigmoid).
 */
export type PredictionSurfaceScale = "response" | "linear-predictor";

/**
 * A fitted exposure-response relationship, evaluable at any exposure
 * value(s) - the live counterpart of `@er-explorer/domain`'s `Prediction`
 * (which is a fixed, already-sampled set of points saved into a
 * `Workspace`/`Session`). A `PredictionSurface` is what an
 * {@link AnalysisModel}'s `predict` returns: something a caller can sample
 * at exactly the exposures it needs (an axis's tick marks, a brushed
 * selection's Q1/median/Q3, ...) without re-fitting.
 *
 * Pure interface: `evaluate` is a method signature a plugin implements,
 * not a function this package provides - "statistics become implementation
 * details" of whichever `AnalysisModel` plugin produced the surface.
 */
export interface PredictionSurface {
  /** Id of the AnalysisModel that produced this surface. */
  readonly analysisModelId: string;
  /** Scale `evaluate`'s estimates are reported on. */
  readonly scale: PredictionSurfaceScale;
  /** Evaluate the fitted relationship at the given exposure values. */
  evaluate(exposures: number[]): PredictionSurfacePoint[];
}
