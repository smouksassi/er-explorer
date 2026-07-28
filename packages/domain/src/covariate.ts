import type { Variable } from "./variable";

/**
 * The scientific purpose a {@link Covariate} is available to serve in an
 * analysis.
 *
 * The same baseline variable (e.g. renal function) might be used purely to
 * adjust a model in one {@link Question}, or as a subgroup to
 * stratify/facet the exposure-response curve by in another.
 * `CovariateRole` records the purpose(s) the covariate is *available* for;
 * a given `Question` picks which one it actually uses
 * ({@link Question.covariateIds} for model adjustment vs.
 * {@link Question.stratificationVariableIds} for faceting).
 */
export type CovariateRole = "adjustment" | "subgroup" | "both";

/**
 * A baseline or time-varying patient/study characteristic that is not
 * itself the exposure or the endpoint, but may explain or modify the
 * exposure-response relationship - e.g. age, weight, renal function,
 * concomitant medication use, or a study/pooling indicator.
 *
 * `Covariate` specializes {@link Variable} with the metadata needed to
 * decide how it may legitimately enter a model or split a view.
 */
export interface Covariate extends Variable {
  role: "covariate";
  /** How this covariate is intended to be used in analyses. */
  covariateRole: CovariateRole;
  /** Reference/baseline level to compare against, for a categorical covariate used in modeling (e.g. `"Placebo"`, `"Normal renal function"`). */
  referenceLevel?: string;
  /** Whether this covariate is measured at baseline only, or can vary over time (e.g. concomitant medication use, which may start or stop mid-study). */
  timeVarying?: boolean;
}
