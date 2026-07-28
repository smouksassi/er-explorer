# @er-explorer/analysis

The analysis engine for ER Explorer (formerly `packages/statistical-engine`).

Statistics become implementation details: this package defines the plugin
contract every exposure-response model implements, not any particular
model's math.

## The plugin architecture (new, interfaces only)

- `analysisModel.ts` - `AnalysisModel`, the central plugin contract
  (`fit` / `predict` / `diagnose` / `confidenceInterval`), plus
  `FitRequest`, `FitOutcome`, `OptimizationSummary` ("Future
  Optimization" - which algorithm a plugin used), and
  `AnalysisModelCapabilities`.
- `predictionSurface.ts` - `PredictionSurface`, a fitted relationship
  evaluable at any exposure on demand (the "Prediction API").
- `diagnostic.ts` - `Diagnostic`, one health/fit-quality finding.
- `confidenceInterval.ts` - `ConfidenceInterval` /
  `ConfidenceIntervalRequest`, covering both "Wald CI" and "Bootstrap" via
  one open-ended `method`.
- `modelRegistry.ts` - `ModelRegistry`, the "Model Registry"
  responsibility: register/look up/list plugins by id or
  `@er-explorer/domain` `ModelFamily`.

No concrete model is implemented here - that's future work, one plugin per
model family (Logistic, Linear, Emax, Ordinal, Kaplan-Meier, Cox, Clinical
Utility), registered against a `ModelRegistry`. No React, no D3, no UI, and
for this surface, no implementation at all: every export is a type or
interface.

## `legacyStatistics.ts` (deprecated)

The original concrete logistic implementation (Newton-Raphson IRLS
fitting, Wald/bootstrap confidence intervals, distribution summaries,
kernel density estimation) is preserved here unchanged, purely for
backward compatibility with `apps/demo`, `packages/visualization-engine`,
and `packages/session-engine`, none of which have migrated to the plugin
architecture above yet. It is not registered against, or otherwise part
of, the new `AnalysisModel`/`ModelRegistry` contracts, and should shrink
and eventually disappear as consumers migrate to a real plugin.

## Scripts

```
pnpm build      # tsc -> dist/ (declarations + JS, test files excluded)
pnpm typecheck  # tsc --noEmit, including test files
pnpm test       # typecheck, then vitest run
```
