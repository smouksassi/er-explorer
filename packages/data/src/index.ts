/**
 * `@er-explorer/data` - the data engine for ER Explorer.
 *
 * Holds the uploaded dataset in memory, always in canonical wide format
 * (`docs/ARCHITECTURE.md`), and never mutates it. Responsibilities:
 *
 * - `loadedDataset.ts` - `loadDataset` builds an immutable, frozen,
 *   column-oriented {@link LoadedDataset} from row- or column-oriented
 *   input. Nothing in this package ever mutates a `LoadedDataset` after
 *   it's created; every query below produces a new derived value instead.
 * - `typeInference.ts` - automatic type inference: `detectBinary`,
 *   `detectCategorical`, `detectContinuous`, and `inferVariableType`
 *   combining them.
 * - `missingValues.ts` - `summarizeMissingValues`, a per-column missing
 *   value summary.
 * - `variableMetadata.ts` / `studyDataset.ts` - turn a `LoadedDataset` into
 *   a `@er-explorer/domain` `StudyDataset` (schema + provenance) via
 *   `buildStudyDataset`, applying type inference to every column.
 * - `filters.ts` / `views.ts` / `longView.ts` / `wideView.ts` - the query
 *   layer: `queryLongView` and `queryWideView` return a lazy
 *   {@link AnalysisView}, generating derived rows (supporting any number of
 *   exposure metrics, endpoints, and covariates at once) on iteration,
 *   without copying the underlying dataset.
 *
 * Contains no plotting, no React, no D3, and no statistical computation -
 * only data loading, inference, and lazy querying.
 */

export { type RawCellValue, isMissing } from "./rawValue";

export { type LoadedDataset, loadDataset, getColumn } from "./loadedDataset";

export { type MissingValueSummary, summarizeMissingValues } from "./missingValues";

export {
  DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD,
  toNumeric,
  isNumericColumn,
  detectBinary,
  detectCategorical,
  detectContinuous,
  type InferVariableTypeOptions,
  type VariableTypeInference,
  inferVariableType
} from "./typeInference";

export {
  type VariableRoleHint,
  type InferredVariable,
  type InferVariableMetadataOptions,
  inferVariableMetadata
} from "./variableMetadata";

export { type BuildStudyDatasetInput, type BuiltStudyDataset, buildStudyDataset } from "./studyDataset";

export { matchesFilter, selectRecordIndices, countMatchingRecords } from "./filters";

export { type AnalysisView, createAnalysisView } from "./views";

export { type LongViewRow, type LongViewQuery, queryLongView } from "./longView";

export { type WideViewRow, type WideViewQuery, queryWideView } from "./wideView";
