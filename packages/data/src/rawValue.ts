/**
 * The value of a single cell in an uploaded wide dataset, before any
 * scientific interpretation is applied.
 *
 * Kept deliberately narrow (no dates, no nested structures) - a raw
 * dataset is just what came out of a CSV/data-transfer file: strings,
 * numbers, booleans, or a missing marker. Turning a `"2026-07-01"` string
 * into an actual date, or a `"1"`/`"0"` string into a binary responder
 * flag, is exactly what type inference (`typeInference.ts`) is for.
 */
export type RawCellValue = string | number | boolean | null | undefined;

/**
 * Whether `value` represents a missing observation.
 *
 * Treats `null`, `undefined`, `NaN`, and an empty/whitespace-only string as
 * missing - the common ways a data transfer or CSV export represents "no
 * value here" - without guessing at dataset-specific sentinel codes (e.g.
 * `-99`), which would require domain knowledge this package doesn't have.
 */
export function isMissing(value: RawCellValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}
