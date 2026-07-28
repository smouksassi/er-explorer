# @er-explorer/model-linear

The first concrete `@er-explorer/analysis` `AnalysisModel` plugin: a
single-predictor ordinary least squares fit for continuous exposure-response
endpoints (e.g. a rating-scale score like `BRLS`/`PRLS`), as opposed to the
legacy logistic implementation's binary responder endpoints.

## Contents

- `ols.ts` - `fitLinearModel`, closed-form OLS (normal equations; no
  iterative optimization needed), returning `LinearParams` (intercept,
  slope, R², residual standard error, and a Wald covariance matrix).
- `confidenceIntervals.ts` - `waldLinearConfidenceIntervals` (analytic,
  via a Student's-t approximation, for the classic "CI ribbon around the
  fitted line") and `bootstrapLinearConfidenceIntervals` (seeded
  case-resampling), implementing the plugin's `"wald"`/`"bootstrap"`
  confidence interval methods.
- `statistics.ts` - `meanConfidenceInterval`: a group's observed mean, CI,
  and n. This is the continuous-endpoint counterpart of a Wilson score
  interval for a binary responder rate - **there is no
  responder/non-responder concept for a continuous endpoint**; what a
  caller shows instead is the mean response, its confidence interval, and
  how many patients contributed to it.
- `prng.ts` - a small seeded PRNG (mulberry32) and percentile helper the
  bootstrap uses, self-contained rather than reused from
  `@er-explorer/analysis`'s deprecated legacy code.
- `plugin.ts` - `linearAnalysisModel`, the actual `AnalysisModel<LinearParams>`
  instance a `ModelRegistry` can register, family `"linear"`.

No React, no D3, no UI - and no dependency on
`@er-explorer/analysis`'s deprecated `legacyStatistics.ts`: this plugin is
independent, self-contained implementation built against the new
interfaces only.

## Scripts

```
pnpm build      # tsc -> dist/ (declarations + JS, test files excluded)
pnpm typecheck  # tsc --noEmit, including test files
pnpm test       # typecheck, then vitest run
```
