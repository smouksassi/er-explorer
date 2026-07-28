import type { CIMethod } from "./question";

/**
 * A single point of a fitted exposure-response curve: the model's estimate
 * at one exposure value, with its confidence interval.
 */
export interface PredictionPoint {
  /** Exposure value this estimate is evaluated at, on the ExposureMetric's original (untransformed) scale. */
  exposure: number;
  /** Point estimate on the response scale (e.g. probability of response for a binary endpoint). */
  estimate: number;
  /** Lower bound of the confidence interval, on the same scale as `estimate`. `NaN` if unavailable. */
  lower: number;
  /** Upper bound of the confidence interval, on the same scale as `estimate`. `NaN` if unavailable. */
  upper: number;
  /** Id of the Endpoint this point belongs to. Required whenever a Prediction spans more than one endpoint (e.g. a "Compare Endpoints" result). */
  endpointId?: string;
}

/**
 * Diagnostics describing whether and how well a model fit converged.
 *
 * Kept generic across model families - a Cox fit and a logistic fit both
 * have *some* notion of convergence and iteration count, even though the
 * underlying algorithms differ completely - so a single `Prediction` shape
 * can carry diagnostics regardless of which {@link ModelFamily} produced
 * it.
 */
export interface ConvergenceDiagnostics {
  /** Whether the fitting algorithm reported successful convergence. */
  converged: boolean;
  /** Number of iterations used. */
  iterations?: number;
  /** Log-likelihood (or equivalent objective) at the fitted solution. */
  logLikelihood?: number;
  /** Number of observations actually used in the fit, after filters and missing-data handling. */
  n?: number;
  /** Free-text warning(s) surfaced during fitting (e.g. `"near-complete separation detected"`). */
  warnings?: string[];
}

/**
 * The fitted result of applying an {@link AnalysisSpec}'s model to the
 * population and variables named in a {@link Question} - the "Prediction"
 * step of ER Explorer's core pipeline: Dataset -> Question -> Model ->
 * Prediction -> Visualization -> Decision (`docs/ARCHITECTURE.md`).
 *
 * A `Prediction` is a pure statistical result: it carries no rendering
 * information (see {@link AnalysisVisualizationConfig} for that) and
 * contains no computation of its own - `packages/domain` has no
 * statistical logic. This interface is the shape that
 * `packages/statistical-engine`'s fitting functions are expected to
 * produce.
 */
export interface Prediction {
  /** Stable identifier within a Workspace/Analysis. */
  id: string;
  /** Id of the AnalysisSpec that produced this prediction. */
  analysisSpecId: string;
  /** Id of the Question this prediction answers. */
  questionId: string;
  /** Fitted curve points: one per requested exposure value, and per endpoint when more than one is being compared. */
  points: PredictionPoint[];
  /** How confidence intervals in `points` were computed for this specific result. Echoes Question.ciMethod, since a Prediction is a completed, immutable record even if the owning Question is later edited. */
  ciMethod: CIMethod;
  /** Confidence level used, e.g. `0.95`. */
  confidenceLevel: number;
  /** Convergence/fit-quality diagnostics for the underlying model. */
  diagnostics?: ConvergenceDiagnostics;
  /** ISO-8601 timestamp of when this prediction was computed. */
  computedAt: string;
}
