# Session handoff (for a fresh Claude session on a new machine)

Purpose: this project has been built almost entirely through Claude Cowork
local sessions, which are tied to the device they run on. This file exists so
a brand-new session can pick up context in one read. Point Cursor or Claude at
this repo and read this file plus `docs/DECISIONS.md` and
`docs/RENDERER_ARCHITECTURE.md`.

Last updated: **2026-08-04** (demo BYOD, compare-endpoints UX, marker layout).

## What this project is

ER Explorer: a pnpm/turborepo monorepo for exploring exposure-response
relationships (dose vs. exposure metrics vs. endpoints), with an interactive
demo app (`apps/demo`) on `@er-explorer/renderer` (Layer/SVG composition).

Workspace packages: `domain`, `analysis`, `model-linear`, `data`, `renderer`,
`session-engine`. **`packages/visualization-engine` is deleted** — do not
resurrect it.

## Current state (2026-08-04)

The renderer migration (Phases 1–7) is complete. On top of that, the demo has
been extended into a **PK-Explorer-style workbench** with BYOD CSV, filters,
facet grids, compare-endpoints overlay, synced axes, and session persistence.

### Bring your own data (BYOD)

- **Load CSV…** → wide table parsed via `apps/demo/src/csvParse.ts`
- **Column mapping** UI (`columnMapping.ts`) with role hints; **Apply mapping**
  builds a `DatasetContext` (`datasetContext.ts`) from `@er-explorer/data`
- Bundled **effICGI** remains via **Reload bundled effICGI**
- **`verify-build.mjs`**: CI-parity `tsc` chain + demo bundle — see `docs/BUILD.md`

### Session / reproducibility

- Save/load JSON session embeds dataset snapshot + mappings + view state
  (`session-engine`); checksum warning if embedded CSV was edited after save
- Persists filters, compare flags, pane heights, readout toggles, selection, etc.

### Data filters

- **`apps/demo/src/dataFilters.ts`**: rule list (numeric ops, categorical in-list)
- Status bar summarizes active filters (e.g. `CMAX ≤ 228; study = S3`) together
  with dose selection and row counts (`describeActiveFilters` in `updateStatus`)

### Layout: facet grid + stacked scatter / distribution

- **Regular grid**: endpoints × exposure metrics; one shared distribution row per
  exposure column when endpoints are rows (`paneSplit.ts`, facet shell in `main.ts`)
- **Compare endpoints** (2+ endpoints): one overlaid scatter row per exposure metric;
  endpoint-colored curves (solid/dash); optional **split distribution by endpoint**
- **Metric stack height**: auto-fill + draggable splitter; scatter/distribution ratio
- **Axis sync**: measure `.metric-stack` width/height, repaint SVGs, `ResizeObserver`
  on facet layout; `schedulePaintSyncedMetricStacks` after readout toggles and dose
  clicks (second frame repaint when readout height changes)

### Compare endpoints — behavior summary

| Element | Regular grid | Compare endpoints |
|--------|--------------|-------------------|
| Scatter points | Dose colors | **Endpoint colors** |
| Curves / CI | Per panel | Overlaid; endpoint color/dash (or neutral gray when split dist off) |
| Dose legend (top) | Shown | **Hidden** |
| Endpoint legend | Hidden | Shown |
| Dose click highlight (dist row) | Dose color | **Neutral slate** (`selectionColor`) |
| Status / readout dose name | Dose-colored | **Plain / neutral gray** |
| Dose projection on scatter | Dose-colored bands | **Neutral** bands; binary **%/N** and linear **mean+CI** callouts |
| Split dist by endpoint off | N/A | Dist shapes neutral; observed annotation boxes use **endpoint dash** on border |

- **Linear endpoints in compare**: dose-click **observed mean + CI** on compare scale
  (`computeContinuousDoseGroupStats`, `projectedLinearGroupsFor`, `observedMean` on
  `ProjectedGroup` in `renderBinaryScatterOverlay`)
- **Dose click** uses `refreshSelectionVisuals()` → repaint stacks (not full `render()`)

### Overlays drawer

- Group exposures by median/tertiles/quartiles; observed %/N; split value; fitted+CI
- **On dose click**: observed rate/mean
- Distribution mode: boxplot / distribution / lineranges; group N
- **Show readout** / **Expand readout** under distribution (collapsible); toggling
  triggers stack repaint for x-axis alignment

### Renderer changes (this sprint)

- **`ObservedStatBin.strokeDash`**: dashed label box borders (compare neutral mode)
- **`DistributionGroupDatum.selectionColor`**: row highlight independent of shape color
- **`svgDrawTarget.drawRect`**: honors `stroke-dasharray` for dashed box borders
- **`markers.ts`**: label layout anchors each callout **just above the marker center `y`**
  (curve height), not at `yHigh` / top of plot; clustered markers at different y stay
  near their curves; leader line from center dot when label is offset

### CI / labeling (prior commit `8846301`, still true)

- CI method **None** omits finite CI on reference markers
- **N=** vs **n=** conventions; **Observed (%/N)** toggle name
- Missing endpoint values in readout: `k missing from N=…`

## Deferred / not in repo

- **`ER_Explorer_Portable_Handoff.zip`**: stale; use this repo + `docs/CURSOR_START_HERE.md`
- R scratch edits in `claudetwoexposureoneendpoint.R` and local PDFs — not part of demo ship

## Practical gotchas

- **OneDrive** can lock `.git/index.lock`; verify with `git status` after commit
- **`dist/`** and `apps/demo/src/data.generated.ts` are gitignored — run
  `node apps/demo/scripts/verify-build.mjs` before manual smoke on `dist/index.html`
- **Dose selection**: click `g.er-ridge` in the distribution strip (`data-group` = dose)
- **`pnpm run clean`**: also removes `*.tsbuildinfo`; see `docs/BUILD.md`

## Verification checklist (manual smoke)

1. `node apps/demo/scripts/verify-build.mjs`
2. Open `apps/demo/dist/index.html`
3. Bundled effICGI: multi-endpoint grid, brush, dose click, overlays
4. **Compare endpoints**: endpoint legend only; points by endpoint; dose click neutral;
   linear mean callout near curve; filters in status bar
5. BYOD: CSV → map → apply → save session → reload
6. Toggle **Show readout** — scatter and distribution x-axes stay aligned
7. `pnpm --filter @er-explorer/renderer test` (marker layout tests)

## Where to look for more

- `docs/BUILD.md` — Windows/CI build commands
- `docs/CURSOR_START_HERE.md` — entry point for Cursor
- `docs/DECISIONS.md` — ADR log (ADR-0009 renderer)
- `docs/RENDERER_ARCHITECTURE.md` — Layer design + migration log
- `apps/demo/src/main.ts` — demo state, render/paint, compare mode, readouts
- `apps/demo/src/dataFilters.ts`, `datasetContext.ts`, `paneSplit.ts`
