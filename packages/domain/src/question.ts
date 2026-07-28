/**
 * How a confidence interval is computed for a {@link Prediction}.
 *
 * ER Explorer supports both a fast analytic approximation and a
 * resampling-based method, and always records which was used, since they
 * can disagree meaningfully at small sample sizes or extreme response
 * rates (see `packages/statistical-engine`'s Wald vs. bootstrap logistic
 * confidence intervals).
 */
export type CIMethod = "wald" | "bootstrap" | "none";

/**
 * Configuration for a nonparametric resampling confidence interval.
 *
 * Recorded so the exact same interval can be reproduced later purely from
 * this configuration plus the underlying dataset - the reproducibility
 * principle that every analysis is recoverable from a session file
 * (`docs/REPRODUCIBILITY.md`) depends on the bootstrap seed being captured,
 * not just the fact that bootstrapping was used.
 */
export interface BootstrapConfig {
  /** Number of resamples to draw. */
  resamples: number;
  /** Seed for the deterministic pseudo-random generator, so results are exactly reproducible. */
  seed: number;
  /** Confidence level, e.g. `0.95` for a 95% interval. */
  level: number;
}

/**
 * How dosed patients are split into groups along an {@link ExposureMetric}
 * for reference-line and per-group summary purposes.
 *
 * Mirrors the reference R package's `exposure_metric_split` parameter.
 * Computed excluding placebo patients, whose exposure is definitionally
 * zero rather than part of the dosed-exposure distribution being split.
 */
export type StratificationSplit = "none" | "median" | "tertile" | "quartile";

/**
 * A single inclusion/exclusion constraint narrowing the population a
 * {@link Question} is asked over (e.g. `"Age >= 18"`,
 * `"Study in {A-101, A-102}"`).
 *
 * Filters compose by logical AND. `packages/domain` does not prescribe how
 * a Filter is evaluated against actual data rows, only what it means.
 */
export interface Filter {
  /** Id of the Variable being filtered. */
  variableId: string;
  /** Comparison operator. */
  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "between";
  /** Value(s) to compare against: a two-element tuple for `"between"`, a list for `"in"`/`"not-in"`, a single value otherwise. */
  value: string | number | Array<string | number>;
  /** Human-readable description of this filter, for display and audit (e.g. `"Renal impairment = Normal"`). */
  label?: string;
}

/**
 * The precise scientific question an analyst is asking of a
 * {@link StudyDataset} - the "Question" step of ER Explorer's core
 * pipeline: Dataset -> Question -> Model -> Prediction -> Visualization ->
 * Decision (`docs/ARCHITECTURE.md`).
 *
 * A `Question` deliberately contains no statistical results of its own: it
 * is the input side of an {@link Analysis}, fully specifying what should be
 * modeled and how uncertainty should be quantified, so that the same
 * Question can be paired with different {@link AnalysisSpec}s - for
 * example, comparing a Wald vs. bootstrap confidence interval, or comparing
 * model families - without re-specifying its scope.
 */
export interface Question {
  /** Stable identifier within a Workspace/Analysis. */
  id: string;
  /** Human-readable statement of the question being asked (e.g. `"How does AUC relate to ICGI response across dose groups?"`). */
  description?: string;
  /** Exposure metric(s) to relate the endpoint(s) to. More than one enables side-by-side exposure-metric comparison. */
  exposureMetricIds: string[];
  /** Clinical endpoint(s) being related to exposure. More than one enables the endpoint-comparison view. */
  endpointIds: string[];
  /** Variable(s) selected to stratify/facet the view by (e.g. splitting by renal-function subgroup), distinct from covariates used only for model adjustment. */
  stratificationVariableIds: string[];
  /** Covariate(s) selected for model adjustment (entered into the model itself, rather than used to facet the view). */
  covariateIds: string[];
  /** Population-narrowing constraints applied before any modeling. */
  filters: Filter[];
  /** How dosed-patient exposure is split for reference lines and group summaries. */
  stratificationSplit: StratificationSplit;
  /** How confidence intervals should be computed when this question is answered. */
  ciMethod: CIMethod;
  /** Bootstrap configuration. Required when `ciMethod` is `"bootstrap"`; ignored otherwise. */
  bootstrapConfig?: BootstrapConfig;
}
