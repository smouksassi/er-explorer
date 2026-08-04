# Building ER Explorer (local / Windows)

Environment: **Node.js ≥ 22.13** (pnpm 11.11 is pinned in root `package.json`). **pnpm 11.11.0** matches CI.

## Fast path (demo only)

From repo root:

```powershell
pnpm install --frozen-lockfile
node apps/demo/scripts/build-data.mjs
node apps/demo/scripts/build.mjs
```

Output: `apps/demo/dist/index.html` (self-contained; open in a browser).

## CI-parity path (all packages + demo typecheck)

Same sequence as [`.github/workflows/deploy-demo.yml`](../.github/workflows/deploy-demo.yml):

```powershell
pnpm install --frozen-lockfile
node_modules/.bin/tsc -p packages/domain/tsconfig.build.json
node_modules/.bin/tsc -p packages/analysis/tsconfig.build.json
node_modules/.bin/tsc -p packages/model-linear/tsconfig.build.json
node_modules/.bin/tsc -p packages/data/tsconfig.build.json
node_modules/.bin/tsc -p packages/renderer/tsconfig.build.json
node_modules/.bin/tsc -p packages/session-engine/tsconfig.build.json
node apps/demo/scripts/build-data.mjs
node_modules/.bin/tsc -p apps/demo/tsconfig.json
node apps/demo/scripts/build.mjs
```

## `pnpm run clean` and incremental TypeScript

Package `clean` scripts remove `dist/` **and** `*.tsbuildinfo`. If you delete `dist/` manually but leave `tsconfig.build.tsbuildinfo`, the next `tsc` may emit **no files**, and downstream packages fail with missing `@er-explorer/domain` declarations.

Fix: run `pnpm run clean` in the package, or delete `packages/*/tsconfig.build.tsbuildinfo` before rebuilding.

## One-command verify (demo + all packages)

```powershell
node apps/demo/scripts/verify-build.mjs
```

Runs the ordered `tsc` chain, regenerates demo data, typechecks the demo, and bundles `dist/index.html`.

## Optional package tests

```powershell
pnpm --filter @er-explorer/renderer test
pnpm --filter @er-explorer/data test
```

## Manual smoke (BYOD demo)

1. Open `apps/demo/dist/index.html`
2. Confirm bundled effICGI charts render
3. **Load CSV…** → upload a wide CSV → map columns → **Apply mapping**
4. **Save session** → reload page → **Load session…** and confirm dataset + view restore (checksum warning if file was edited)
5. **Filters** drawer: add rules → status bar shows human-readable filter text
6. **Compare endpoints** (2+ endpoints): endpoint legend; dose click → neutral dist highlight;
   linear endpoint shows mean callout near curve after dose click
7. **Overlays → Show readout**: toggle and confirm scatter/distribution x-axes stay aligned

Full checklist: [SESSION_HANDOFF.md](./SESSION_HANDOFF.md#verification-checklist-manual-smoke).
