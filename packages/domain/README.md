# @er-explorer/domain

The scientific domain model for ER Explorer: pure TypeScript interfaces and
type aliases describing exposure-response analysis, with no statistical
logic and no rendering/UI code.

This is the root dependency of the project - every other package
(`statistical-engine`, `visualization-engine`, `session-engine`, and
`apps/demo`) may depend on it; it depends on nothing else in this repo.

## Contents

`Variable`, `ExposureMetric`, `Endpoint`, and `Covariate` describe the
columns of a `StudyDataset`. `Selection` describes what is currently
highlighted. `Question` describes what is being asked (exposure metrics,
endpoints, stratification, covariates, filters, CI method, bootstrap
config). `AnalysisSpec` describes the model chosen to answer it.
`Prediction` describes the fitted result. `Analysis` ties a `Question`,
`AnalysisSpec`, `Prediction`, and a lightweight visualization configuration
together. `Workspace` groups a `StudyDataset` with its `Analysis` list,
notes, and export history. `Session` is a small, reloadable snapshot of a
`Workspace`'s active `Analysis` and `Selection`, plus enough version/
checksum information to judge reproducibility on reload.

See `docs/ARCHITECTURE.md` for how these fit into ER Explorer's core
pipeline (Dataset → Question → Model → Prediction → Visualization →
Decision) and `docs/REPRODUCIBILITY.md` for how `Session` supports
reproducible analysis.

## Scripts

```
pnpm build      # tsc -> dist/ (declarations + JS, test files excluded)
pnpm typecheck  # tsc --noEmit, including test files
pnpm test       # typecheck, then vitest run
```
