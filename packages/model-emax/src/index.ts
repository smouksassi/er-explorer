/**
 * `@er-explorer/model-emax` — Emax/Hill plugin (ADR-0013's fourth family).
 *
 * Continuous endpoints only (binary Emax was considered and parked — see
 * `.ai/CONTINUE_HERE.md`). Fitting is deterministic and needs no starting
 * values: grid search over (EC50, γ) with the model's conditional linearity
 * in (E0, Emax) at each grid point, then golden-section refinement.
 */
export {
  EMAX_MIN_N,
  EMAX_MIN_DISTINCT_POSITIVE_X,
  fitEmax,
  predictEmax,
  predictEmaxAt,
  describeEmaxFit,
  tQuantile975,
  type EmaxFit,
  type EmaxOptions,
  type EmaxPrediction
} from "./emax";
