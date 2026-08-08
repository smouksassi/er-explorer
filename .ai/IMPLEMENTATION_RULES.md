# Implementation rules (stabilization phase)

Applies after architectural review approval. Complements [`.cursor/rules/er-explorer.mdc`](../.cursor/rules/er-explorer.mdc).

## When implementing

- **Smallest safe refactor** — one concern per change set.
- **Focused commits** — user creates commits when asked; do not batch unrelated fixes.
- **Preserve the demo** — `apps/demo/dist` rebuilds in CI; behavior regressions are unacceptable unless explicitly agreed.
- **Preserve existing behavior** unless the task is an approved behavior change (document in PR/commit and `docs/` or `.ai/`).
- **Update documentation** — user-facing in `docs/`; agent/process in `.ai/`; ADRs in `docs/DECISIONS.md` when decisions change.
- **Update tests** — domain/data/renderer/session/analysis packages as touched; add enumeration/layout tests for spec changes.

## Package boundaries (do not violate)

| Package | May import | Must not |
|---------|------------|----------|
| **domain** | (nothing in repo) | analysis, data, renderer, demo |
| **data** | domain | renderer, demo UI |
| **analysis** / plugins | domain, analysis interfaces | renderer |
| **renderer** | domain | analysis, data, statistics |
| **session-engine** | domain | renderer |
| **apps/demo** | all packages | — (orchestration only; avoid new statistics in paint paths long-term) |

Fits and CIs in demo are **accepted debt** until per-panel `AnalysisSpec` wiring exists; new features should not deepen that debt without a plan.

## Stop conditions

**STOP and explain trade-offs; wait for approval** when:

- An architectural decision is unclear (e.g. selection semantics, session shape, breaking Guided presets).
- A change would **remove or rename** session fields without migration.
- A change requires **two mount/render paths** instead of converging on one.
- Scientific workflow is ambiguous — **never invent** pharmacometric workflows; ask or document assumption in `.ai/` and get sign-off.

**Never** optimize for short-term demo convenience over long-term maintainability (e.g. new `if (compareEndpoints)` branches in `main.ts`).

## Lead-engineer mindset

- Build around **analyses and serializable questions**, not around plot types.
- **Endpoint** should become one **grouping/measure role** in encoding, not a parallel compare subsystem.
- Guided controls are **presets** that write `ViewLayoutSpec`; Advanced edits the spec directly.
