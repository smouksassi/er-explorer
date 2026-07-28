import type { Variable, VariableRole } from "@er-explorer/domain";
import type { RawCellValue } from "./rawValue";
import { type MissingValueSummary, summarizeMissingValues } from "./missingValues";
import { type InferVariableTypeOptions, inferVariableType } from "./typeInference";

/**
 * The scientific-role metadata automatic inference cannot recover from raw
 * values alone - a column of `0`/`1` values could be an endpoint, a
 * covariate, or an administrative flag; only the analyst (or a mapping
 * step built on top of this package) knows which. Supplying a
 * `VariableRoleHint` for a column lets {@link inferVariableMetadata} record
 * that intent instead of leaving every column at the `"administrative"`
 * default.
 */
export interface VariableRoleHint {
  role: VariableRole;
  label?: string;
  unit?: string;
  description?: string;
}

/**
 * A {@link Variable} enriched with the data-level statistics that produced
 * it - everything `@er-explorer/domain`'s `Variable` doesn't carry because
 * it describes a column's *meaning*, not its *observed contents*. Useful on
 * its own (e.g. for a future data-quality/completeness view) even when the
 * plain `Variable` is all a `StudyDataset` needs.
 */
export interface InferredVariable extends Variable {
  /** Number of distinct non-missing values observed. */
  distinctCount: number;
  /** How much of this column is missing. */
  missing: MissingValueSummary;
}

export interface InferVariableMetadataOptions extends InferVariableTypeOptions {
  roleHint?: VariableRoleHint;
}

/**
 * Infer a {@link Variable}'s metadata - type (via {@link inferVariableType}),
 * levels, and missing-value summary - from one column's raw values.
 *
 * `allowsMissing` is set from the data itself (true iff at least one value
 * is actually missing); `role` defaults to `"administrative"` ("not yet
 * scientifically categorized") unless a `roleHint` is supplied, since role
 * is analyst intent this package has no way to guess.
 */
export function inferVariableMetadata(variableId: string, values: ReadonlyArray<RawCellValue>, options: InferVariableMetadataOptions = {}): InferredVariable {
  const typeInference = inferVariableType(values, options);
  const missing = summarizeMissingValues(values);

  return {
    id: variableId,
    name: variableId,
    label: options.roleHint?.label ?? variableId,
    role: options.roleHint?.role ?? "administrative",
    type: typeInference.type,
    unit: options.roleHint?.unit,
    levels: typeInference.levels,
    description: options.roleHint?.description,
    allowsMissing: missing.missingCount > 0,
    distinctCount: typeInference.distinctCount,
    missing
  };
}
