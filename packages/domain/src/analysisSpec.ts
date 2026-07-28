/**
 * The statistical model family used to answer a {@link Question}.
 *
 * Which values are scientifically valid depends on the selected
 * {@link Endpoint}(s)' {@link EndpointKind} (e.g. `"logistic"` for binary
 * endpoints, `"cox"` for time-to-event endpoints). `packages/domain` does
 * not enforce this pairing itself - it contains no business logic - but
 * records enough information that a validating layer elsewhere in the
 * system can.
 */
export type ModelFamily =
  | "logistic"
  | "linear"
  | "ordinal-logistic"
  | "poisson"
  | "cox"
  | "emax"
  | "custom";

/**
 * A generic bag of named tuning parameters for a model fit (e.g. a ridge
 * penalty, a maximum iteration count, a convergence tolerance).
 *
 * Kept as a key/value bag rather than one field per possible option, since
 * valid options vary by {@link ModelFamily} and `packages/domain`
 * intentionally has no knowledge of any specific fitting algorithm's
 * implementation.
 */
export type ModelOptions = Record<string, number | string | boolean>;

/**
 * The full specification of the statistical model to be fit in order to
 * answer a {@link Question} - the "Model" step of ER Explorer's core
 * pipeline: Dataset -> Question -> Model -> Prediction -> Visualization ->
 * Decision (`docs/ARCHITECTURE.md`).
 *
 * `AnalysisSpec` is a specification only: it says what model *would be* or
 * *was* fit, not the fitted result itself (see {@link Prediction} for
 * that). Separating `AnalysisSpec` from {@link Question} means the same
 * scientific question can be answered by more than one model family or
 * configuration - e.g. comparing a linear vs. an Emax exposure-response
 * shape - without restating exposure metrics, endpoints, filters, and so
 * on.
 */
export interface AnalysisSpec {
  /** Stable identifier within a Workspace/Analysis. */
  id: string;
  /** The model family used to relate exposure to response. */
  modelFamily: ModelFamily;
  /** Human-readable description of the model (e.g. `"Single-predictor logistic regression on log(AUC)"`). */
  description?: string;
  /** Exposure transform the model is fit on. Echoes the relevant ExposureMetric's `transform` by default, but kept here too since a model could in principle be refit on a different scale than the metric's own default. */
  exposureTransform?: "identity" | "log";
  /** Estimation method used to fit the model (e.g. `"newton-raphson-irls"`, `"maximum-likelihood"`). */
  estimationMethod?: string;
  /** Free-form fitting options/tuning parameters (ridge penalty, iteration caps, convergence tolerance, ...). */
  options?: ModelOptions;
  /** Version identifier of the statistical engine implementation that fit (or would fit) this spec, for reproducibility across engine upgrades. */
  engineVersion?: string;
}
