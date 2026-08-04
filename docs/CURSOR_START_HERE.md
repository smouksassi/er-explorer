# Cursor start here

ER Explorer is a pnpm/turborepo workbench for exposure–response analysis. **Do not** follow the stale guidance in `ER_Explorer_Portable_Handoff.zip` (Sprint 0.2 foundation)—the repo is far ahead of that bundle.

## Read first

1. [SESSION_HANDOFF.md](./SESSION_HANDOFF.md) — current demo state, gotchas (OneDrive git locks), verification habits
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — package boundaries and data flow
3. [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) — session / `.erx` intent
4. [ROADMAP.md](./ROADMAP.md) — backlog

## Active work (2026-08-04)

**Demo BYOD** is implemented: wide CSV, column mapping, session save/load with embedded dataset.

**Compare endpoints** supports mixed binary + linear endpoints, neutral dose selection styling,
endpoint-colored points, filter summary in the status bar, facet stack + axis sync, and
callout labels anchored near each curve (`packages/renderer/src/markers.ts`).

See [SESSION_HANDOFF.md](./SESSION_HANDOFF.md) for the full feature list and smoke checklist.

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
