# Cursor start here

ER Explorer is a pnpm/turborepo workbench for exposure–response analysis. **Do not** follow the stale guidance in `ER_Explorer_Portable_Handoff.zip` (Sprint 0.2 foundation)—the repo is far ahead of that bundle.

## Read first

1. [SESSION_HANDOFF.md](./SESSION_HANDOFF.md) — current demo state, gotchas (OneDrive git locks), verification habits
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — package boundaries and data flow
3. [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) — session / `.erx` intent
4. [ROADMAP.md](./ROADMAP.md) — backlog
5. [../.ai/README.md](../.ai/README.md) — architecture stabilization review, layout/encoding debt, implementation rules
6. [../.ai/CONTINUE_HERE.md](../.ai/CONTINUE_HERE.md) — **latest agent handoff (2026-08-07): Phase 0+1 + demo UX**

## Active work (2026-08)

**Layout stabilization (Phase 0+1 done):** domain visual policy + demo wiring. **Next:** Phase 2 selection model + Guided→spec presets — see `.ai/CONTINUE_HERE.md`.

- Data engine: `@er-explorer/data`; demo adapter: `apps/demo/src/datasetContext.ts`
- Build: [BUILD.md](./BUILD.md) — `node apps/demo/scripts/verify-build.mjs`

## Quick build (demo)

```powershell
cd er-explorer
pnpm install --frozen-lockfile
node apps/demo/scripts/build-data.mjs
node apps/demo/scripts/build.mjs
# open apps/demo/dist/index.html
```

Full CI-parity build: see [BUILD.md](./BUILD.md).
