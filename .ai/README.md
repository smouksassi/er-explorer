# ER Explorer — agent session context

Persistent notes for AI assistants and contributors. **Official product docs stay in `docs/`**; this folder captures stabilization work, debt, and agreed process so we do not re-derive it every session.

## Read first (canonical)

| Doc | Purpose |
|-----|---------|
| [`docs/VISION.md`](../docs/VISION.md) | Mission: Question → Evidence → Decision |
| [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) | Package pipeline and responsibilities |
| [`docs/PRINCIPLES.md`](../docs/PRINCIPLES.md) | Non-negotiables |
| [`docs/DECISIONS.md`](../docs/DECISIONS.md) | ADRs |
| [`docs/REPRODUCIBILITY.md`](../docs/REPRODUCIBILITY.md) | Session / `.erx` |
| [`docs/SESSION_HANDOFF.md`](../docs/SESSION_HANDOFF.md) | Demo behavior and file map |
| [`docs/ADVANCED_LAYOUT.md`](../docs/ADVANCED_LAYOUT.md) | `ViewLayoutSpec` and Guided ↔ Advanced |
| [`docs/BUILD.md`](../docs/BUILD.md) | Verify build and tests |

## Read for current stabilization (this folder)

| File | Purpose |
|------|---------|
| [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) | Full review: debt, boundaries, tests, docs gaps, **prioritized plan** (Critical / Important / Nice to have) |
| [`LAYOUT_AND_ENCODING.md`](./LAYOUT_AND_ENCODING.md) | Endpoint/compare heuristics, target encoding model, known UI bugs |
| [`IMPLEMENTATION_RULES.md`](./IMPLEMENTATION_RULES.md) | How to implement refactors; stop conditions |
| [**`CONTINUE_HERE.md`**](./CONTINUE_HERE.md) | **Latest session handoff — read this when resuming work** |

## Project status (one paragraph)

Monorepo with a **working demo** (`apps/demo`) on a **credible package skeleton** (domain → data → analysis/plugins → renderer → session). Renderer migration is largely done. **Architecture stabilization** is the current phase: reduce coupling in the demo, clarify layout/encoding/selection in domain + data, align session persistence—**without** rewriting the app or treating ER Explorer as a plotting library.

## Verify before claiming done

```powershell
node apps/demo/scripts/verify-build.mjs
pnpm --filter @er-explorer/domain test
pnpm --filter @er-explorer/data test
pnpm --filter @er-explorer/renderer test
pnpm --filter @er-explorer/demo smoke:ui
```

Headless UI smoke (Phase 0+1 layout policy): `node apps/demo/scripts/ui-smoke.mjs` — requires Playwright Chromium (`npx playwright install chromium` from `apps/demo` once).

## Approval gate

Items marked **Critical** in `ARCHITECTURE_REVIEW.md` need explicit user approval before large implementation series. Prefer ADR in `docs/DECISIONS.md` for encoding/selection model changes.
