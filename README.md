# ER Explorer

## Interactive Exposure–Response Modeling and Clinical Decision Support

> Helping scientists answer exposure–response questions through interactive, reproducible, and publication-quality visualization.

ER Explorer is an open-source scientific workbench for exposure–response analysis.

See the documentation in `docs/` for the project vision and roadmap.

## Packages

- `packages/domain` — the scientific domain model (`@er-explorer/domain`): pure TypeScript interfaces and types only. The root dependency of the project; every other package may depend on it, it depends on nothing else in this repo.
- `packages/data` — the data engine (`@er-explorer/data`): immutable wide dataset loading, automatic type inference, and lazy derived analysis views (long/wide), without copying the underlying dataset.
- `packages/analysis` — the analysis engine (`@er-explorer/analysis`, formerly `packages/statistical-engine`): the `AnalysisModel`/`PredictionSurface`/`Diagnostic`/`ConfidenceInterval`/`ModelRegistry` plugin architecture. No concrete model ships here - statistics are an implementation detail of a future plugin per model family.
- `packages/visualization-engine` — publication-quality SVG rendering.
- `packages/session-engine` — reproducible session capture/reload (the `.erx` session file format).
- `apps/demo` — a minimal interactive exposure-response demo built on the packages above.
