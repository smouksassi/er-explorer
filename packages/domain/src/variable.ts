/**
 * The scientific role a {@link Variable} plays in an exposure-response
 * analysis.
 *
 * ER Explorer treats every column of a {@link StudyDataset} as a Variable
 * first, and only afterward asks *how* that variable is being used in a
 * particular {@link Question} - the same continuous PK variable might be an
 * {@link ExposureMetric} in one analysis and a {@link Covariate} used for
 * adjustment in another. `role` records the variable's primary/intended
 * scientific purpose; it does not prevent a downstream Question from
 * reusing it differently.
 */
export type VariableRole =
  | "identifier"
  | "exposure"
  | "endpoint"
  | "covariate"
  | "stratification"
  | "time"
  | "administrative";

/**
 * The measurement scale of a {@link Variable}'s values, independent of its
 * {@link VariableRole}.
 *
 * This determines what statistical treatment and visual encodings are
 * scientifically valid for the variable - e.g. a `"binary"` variable can be
 * modeled as a logistic {@link Endpoint}; a `"time-to-event"` variable
 * requires survival/hazard modeling and an associated censoring indicator.
 */
export type VariableType =
  | "continuous"
  | "binary"
  | "ordinal"
  | "nominal"
  | "count"
  | "time-to-event"
  | "date";

/**
 * One valid categorical level of a {@link Variable} whose {@link VariableType}
 * is `"ordinal"`, `"nominal"`, or `"binary"`.
 *
 * Example: `{ value: "1", label: "Responder" }` for a binary responder
 * endpoint, or `{ value: "2", label: "Severe", order: 3 }` for an ordinal
 * severity scale.
 */
export interface VariableLevel {
  /** Raw stored value in the underlying dataset (kept as a string so coded and text levels are represented uniformly). */
  value: string;
  /** Human-readable label for this level, suitable for display in legends and tables. */
  label: string;
  /** Ordinal rank of this level relative to the others. Required when the parent Variable's `type` is `"ordinal"`; meaningless otherwise. */
  order?: number;
}

/**
 * A single named, typed column of a {@link StudyDataset}, described richly
 * enough that ER Explorer can reason about it scientifically rather than
 * merely render it.
 *
 * `Variable` is the atomic unit of the ER Explorer domain model.
 * {@link ExposureMetric}, {@link Endpoint}, and {@link Covariate} are all
 * specializations of `Variable` that layer role-specific scientific
 * metadata on top of this common shape. Every `Variable` belongs to exactly
 * one `StudyDataset` and is referenced by id elsewhere in the domain model
 * (in a {@link Question}, {@link AnalysisSpec}, {@link Prediction}, etc.)
 * rather than being duplicated.
 *
 * This interface carries no data values and no logic - only the metadata
 * needed to interpret a column correctly. Loading, parsing, and validating
 * the actual row values is deliberately outside the scope of
 * `packages/domain`.
 */
export interface Variable {
  /** Stable identifier, unique within the owning StudyDataset (e.g. `"AUCss"`). */
  id: string;
  /** Column name as it appears in the underlying wide dataset. */
  name: string;
  /** Human-readable label for display (e.g. `"Steady-state AUC"`). */
  label: string;
  /** The scientific role this variable plays. */
  role: VariableRole;
  /** The measurement scale of the variable's values. */
  type: VariableType;
  /** Unit of measurement, if applicable (e.g. `"ng*h/mL"`, `"mg"`, `"%"`). Omitted for unitless or categorical variables. */
  unit?: string;
  /** For ordinal, nominal, or binary variables: the ordered set of valid levels and their display labels. */
  levels?: VariableLevel[];
  /** Free-text scientific description of what the variable measures, how it was derived, and any caveats. */
  description?: string;
  /** Whether missing values are an expected/permitted state for this variable in the dataset. */
  allowsMissing?: boolean;
}
