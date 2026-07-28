import { isMissing, type RawCellValue } from "./rawValue";

/**
 * How much of a single column is missing.
 *
 * Computed once per column during {@link inferVariableMetadata}, and
 * exposed on its own so a future data-quality view can list every
 * variable's completeness without recomputing type inference.
 */
export interface MissingValueSummary {
  /** Total number of rows considered. */
  totalCount: number;
  /** Number of rows whose value is missing (see `isMissing`). */
  missingCount: number;
  /** Number of rows with a present value. */
  presentCount: number;
  /** `missingCount / totalCount`, or `0` for an empty column. */
  missingFraction: number;
}

/** Summarize how much of `values` is missing. */
export function summarizeMissingValues(values: ReadonlyArray<RawCellValue>): MissingValueSummary {
  const totalCount = values.length;
  let missingCount = 0;
  for (const value of values) {
    if (isMissing(value)) missingCount++;
  }
  return {
    totalCount,
    missingCount,
    presentCount: totalCount - missingCount,
    missingFraction: totalCount === 0 ? 0 : missingCount / totalCount
  };
}
