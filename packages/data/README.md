# @er-explorer/data

The data engine for ER Explorer: holds the uploaded dataset in memory,
always in canonical wide format, and never mutates it.

Contains no plotting, no React, no D3, and no statistical computation -
only data loading, automatic type inference, and lazy querying.

## Contents

- `loadDataset` (`loadedDataset.ts`) - builds an immutable, frozen,
  column-oriented `LoadedDataset` from row- or column-oriented input.
  Nothing in this package mutates a `LoadedDataset` after it's created;
  every query below produces a new derived value instead.
- Automatic type inference (`typeInference.ts`) - `detectBinary`,
  `detectCategorical`, `detectContinuous`, and `inferVariableType`
  combining them (binary > categorical > continuous). Automatic inference
  only ever produces `"continuous"`, `"binary"`, or `"nominal"` -
  `@er-explorer/domain`'s other `VariableType`s (`"ordinal"`, `"count"`,
  `"time-to-event"`, `"date"`) encode intent that has to be set explicitly.
- `summarizeMissingValues` (`missingValues.ts`) - a per-column missing
  value summary (count/fraction).
- `buildStudyDataset` (`studyDataset.ts` / `variableMetadata.ts`) - turns a
  `LoadedDataset` into a `@er-explorer/domain` `StudyDataset` (schema +
  provenance) by running type inference over every column, with optional
  per-column role hints (exposure/endpoint/covariate/...) since role is
  analyst intent this package can't guess.
- The query layer (`filters.ts` / `views.ts` / `longView.ts` /
  `wideView.ts`) - `queryLongView` and `queryWideView` return a lazy
  `AnalysisView`: constructing one does no work, and iterating it (or
  calling `.toArray()`) generates rows on demand directly from the
  `LoadedDataset`'s columns, without ever copying the dataset itself.
  `queryLongView` supports any number of exposure metrics, endpoints, and
  covariates at once, producing one row per (record x exposure metric x
  endpoint) - the "Compare Endpoints"-style tidy/long shape - while
  `queryWideView` projects a column subset back out in the original
  one-row-per-subject shape.

## Scripts

```
pnpm build      # tsc -> dist/ (declarations + JS, test files excluded)
pnpm typecheck  # tsc --noEmit, including test files
pnpm test       # typecheck, then vitest run
```
