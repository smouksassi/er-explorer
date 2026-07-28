import type { Variable } from "./variable";

/**
 * The pharmacokinetic quantity an {@link ExposureMetric} summarizes.
 */
export type ExposureMetricKind =
  | "dose"
  | "auc"
  | "cmax"
  | "cmin"
  | "cavg"
  | "time-above-threshold"
  | "other";

/**
 * How an exposure value should be treated on the model/analysis scale.
 *
 * Many exposure-response relationships are approximately linear (or at
 * least better behaved) on a log-exposure scale. ER Explorer records this
 * choice explicitly on the metric itself, rather than inferring it at fit
 * time, so that model fitting, axis scaling, and stratification-split-point
 * computation all agree on the same scale.
 */
export type ExposureTransform = "identity" | "log";

/**
 * A pharmacokinetic exposure summary metric - the "exposure" side of an
 * exposure-response question (e.g. steady-state AUC, Cmax, average
 * concentration, or nominal dose itself).
 *
 * `ExposureMetric` specializes {@link Variable} with the PK-specific
 * metadata needed to correctly fit and label an exposure-response curve.
 * ER Explorer analyses may consider more than one `ExposureMetric` at once
 * (e.g. comparing AUC vs. Cmax as the better exposure summary for the same
 * endpoint) - see {@link Question.exposureMetricIds}.
 */
export interface ExposureMetric extends Variable {
  role: "exposure";
  /** The PK quantity this metric summarizes. */
  metricKind: ExposureMetricKind;
  /** Scale that exposure-response fitting and axis rendering should use for this metric. */
  transform: ExposureTransform;
  /** Dosing interval or PK sampling window this metric was derived over, when applicable (e.g. `"0-24h"`, `"steady-state"`). */
  interval?: string;
  /** Analyte/matrix the exposure was measured in (e.g. `"parent drug, plasma"`), when relevant to distinguish it from a metabolite or alternate matrix. */
  analyte?: string;
  /** Value representing "no exposure" (e.g. `0` for placebo). Used to anchor exposure-response curves and distribution panels at the unexposed reference condition. */
  referenceValue?: number;
}
