# Architecture

Canonical datasets remain wide.
Long analysis views are generated lazily.

Separate:
- Domain (scientific domain model: interfaces and types only)
- Data (dataset loading, type inference, lazy analysis views)
- Statistical Engine
- Visualization Engine
- Session Engine

`packages/domain` is the root dependency of the project. It defines the
shared vocabulary (`StudyDataset`, `Variable`, `ExposureMetric`, `Endpoint`,
`Covariate`, `Selection`, `Question`, `AnalysisSpec`, `Prediction`,
`Analysis`, `Workspace`, `Session`) that every other package speaks, and it
contains no statistical logic, no rendering code, and no imports from any
other package in this repo - everything else may depend on it, it depends
on nothing here.

`packages/data` holds the uploaded dataset in memory - always wide, never
mutated - and builds a `StudyDataset` from it via automatic type inference
(continuous/binary/categorical detection, missing value summaries). It
exposes queries (`queryLongView`, `queryWideView`) that return a lazy
`AnalysisView`: long/derived rows for any number of exposure metrics,
endpoints, and covariates at once are generated on iteration, not
precomputed or copied from the canonical wide dataset.

Everything revolves around:
StudyDataset → Question → AnalysisSpec → Prediction → Visualization → Decision
