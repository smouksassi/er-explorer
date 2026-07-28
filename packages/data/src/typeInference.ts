import type { VariableLevel, VariableType } from "@er-explorer/domain";
import { isMissing, type RawCellValue } from "./rawValue";

/** Default cutoff for how many distinct values a *numeric* column can have before it's treated as continuous rather than categorical (e.g. a 1-5 coded dose-group column vs. a measured AUC). Non-numeric columns are always categorical/binary regardless of this threshold - there is no "continuous string". */
export const DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD = 10;

/** A non-missing value together with a stable comparison key, used to de-duplicate values without losing a representative original value for display (e.g. distinguishing `1` from `"1"` while still counting them as the same level). */
interface DistinctValue {
  key: string;
  value: RawCellValue;
}

function toComparisonKey(value: RawCellValue): string {
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  return `s:${String(value).trim()}`;
}

/** Parse `value` as a finite number if it clearly represents one (a JS number, or a string containing only a numeric literal); otherwise `undefined`. Deliberately strict about strings - `"3.5"` parses, `"3.5 mg"` and `""` do not - so an identifier column that happens to contain digits isn't mistaken for a measurement. */
export function toNumeric(value: RawCellValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function distinctNonMissing(values: ReadonlyArray<RawCellValue>): DistinctValue[] {
  const seen = new Map<string, RawCellValue>();
  for (const value of values) {
    if (isMissing(value)) continue;
    const key = toComparisonKey(value);
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.entries()].map(([key, value]) => ({ key, value }));
}

/** Whether every non-missing value in `values` parses as a number (see {@link toNumeric}). An empty column (no non-missing values) is not numeric - there's nothing to base that on. */
export function isNumericColumn(values: ReadonlyArray<RawCellValue>): boolean {
  let sawAny = false;
  for (const value of values) {
    if (isMissing(value)) continue;
    sawAny = true;
    if (toNumeric(value) === undefined) return false;
  }
  return sawAny;
}

/** Binary detection: exactly two distinct non-missing values, of any type (`0`/`1`, `"Yes"`/`"No"`, `true`/`false`, ...). */
export function detectBinary(values: ReadonlyArray<RawCellValue>): boolean {
  return distinctNonMissing(values).length === 2;
}

/**
 * Categorical detection: more than two distinct values that either aren't
 * uniformly numeric (text labels), or are numeric but low-cardinality
 * (fewer distinct values than `threshold` - e.g. a 1-5 coded dose group),
 * which reads as a set of categories rather than a continuous measurement.
 */
export function detectCategorical(values: ReadonlyArray<RawCellValue>, threshold: number = DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD): boolean {
  const distinct = distinctNonMissing(values);
  if (distinct.length <= 2) return false; // 0 or 1 distinct value: degenerate; 2: binary, not categorical
  if (!isNumericColumn(values)) return true;
  return distinct.length <= threshold;
}

/** Continuous detection: uniformly numeric with enough distinct values that it reads as a measurement rather than a set of categories. */
export function detectContinuous(values: ReadonlyArray<RawCellValue>, threshold: number = DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD): boolean {
  if (!isNumericColumn(values)) return false;
  const distinct = distinctNonMissing(values);
  return distinct.length > Math.max(2, threshold);
}

export interface InferVariableTypeOptions {
  /** Distinct-value cutoff separating a low-cardinality numeric column (categorical) from a continuous one. Defaults to {@link DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD}. */
  categoricalNumericThreshold?: number;
}

export interface VariableTypeInference {
  /** The inferred type. Automatic inference only ever produces `"continuous"`, `"binary"`, or `"nominal"` (categorical) - domain's other VariableTypes (`"ordinal"`, `"count"`, `"time-to-event"`, `"date"`) encode scientific intent auto-detection cannot recover from raw values alone, and must be set explicitly by the analyst. */
  type: Extract<VariableType, "continuous" | "binary" | "nominal">;
  /** Number of distinct non-missing values observed. */
  distinctCount: number;
  /** For `"binary"`/`"nominal"`, the distinct values observed, as VariableLevels (value/label only - order is left unset since raw data carries no ordering information). Omitted for `"continuous"`. */
  levels?: VariableLevel[];
}

/**
 * Infer a column's {@link VariableType} from its raw values: binary
 * (exactly two distinct values) takes priority, then categorical
 * (see {@link detectCategorical}), then continuous as the fallback for a
 * high-cardinality numeric column. A column with zero non-missing values
 * (nothing to infer from) falls back to `"nominal"` with no levels.
 */
export function inferVariableType(values: ReadonlyArray<RawCellValue>, options: InferVariableTypeOptions = {}): VariableTypeInference {
  const threshold = options.categoricalNumericThreshold ?? DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD;
  const distinct = distinctNonMissing(values);

  if (distinct.length === 2) {
    return { type: "binary", distinctCount: 2, levels: toLevels(distinct) };
  }
  if (detectContinuous(values, threshold)) {
    return { type: "continuous", distinctCount: distinct.length };
  }
  // Categorical, including the degenerate 0/1-distinct-value case, which
  // has nothing meaningful to be continuous about.
  return { type: "nominal", distinctCount: distinct.length, levels: toLevels(distinct) };
}

function toLevels(distinct: DistinctValue[]): VariableLevel[] {
  return distinct
    .map(({ value }) => ({ value: String(value), label: String(value) }))
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
}
