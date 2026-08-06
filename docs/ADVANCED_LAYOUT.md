# Advanced layout (Guided parity + ggquickeda-style faceting)

Advanced mode expresses plot layout as a serializable **`ViewLayoutSpec`**. Guided mode is unchanged for users but internally compiles to the same spec so one render path drives both.

## Core types

See [`packages/domain/src/viewLayout.ts`](../packages/domain/src/viewLayout.ts):

- **`LayoutDimension`**: `endpoints`, `xMetrics`, or a dataset `variable` (sex, study, …).
- **`ViewLayoutSpec`**: row/column dimension lists, color encoding, distribution linkage, optional `fitByColor`.
- **`ScatterPanelSpec` / `DistPanelSpec`**: enumerated cells after filters.

## Distribution linkage

| Linkage | Scatter | Distribution |
|---------|---------|----------------|
| `mirror_scatter_grid` | Full facet grid | One dist cell per scatter cell (same facet keys + x) |
| `shared_by_x_column` | Faceted (e.g. by endpoint) | **One dist strip per x-metric column only** (Guided default when endpoints are rows) |
| `single_pooled` | Any | One dist row per x-metric across entire filtered cohort |
| `mirror_color_only` | Single grid | Dose rows; shapes split by color variable within each dose row |

User-facing: **Mirror boxplots to scatter facets** toggles `mirror_scatter_grid` vs Guided-style `shared_by_x_column`.

## Guided → Advanced bijection

| Guided control | `ViewLayoutSpec` |
|----------------|------------------|
| Endpoints as rows · X as columns | `rowDimensions: [endpoints]`, `colDimensions: [xMetrics]`, `color: dose`, `distribution.linkage: shared_by_x_column` |
| Exposures as rows · endpoints as columns | `rowDimensions: [xMetrics]`, `colDimensions: [endpoints]`, `color: dose`, `distribution.linkage: mirror_scatter_grid` |
| Compare endpoints | `endpointOverlay: true`, `colDimensions: [xMetrics]`, empty row dims (one overlay row), `color: endpoints`, linkage per compare dist checkbox |
| Split distribution by endpoint (compare) | `distribution.linkage: mirror_scatter_grid`, `colorDistShapes` / endpoint-colored dist |
| Exposure / endpoint drag order | `order` arrays on each dimension |

Implementation: [`apps/demo/src/guidedViewLayout.ts`](../apps/demo/src/guidedViewLayout.ts).

## Example specs (JSON)

### Snapshot 1 — `Endpoint ~ SEX + expname` (ggquickeda)

Color and fit by sex; dist mirrors each scatter column.

```json
{
  "mode": "advanced",
  "rowDimensions": [],
  "colDimensions": [
    { "kind": "endpoints", "ids": ["icgi", "icgi2"], "order": ["icgi", "icgi2"] },
    { "kind": "variable", "variableId": "sex", "order": ["1", "2"] },
    { "kind": "xMetrics", "ids": ["auc", "cmax"], "order": ["auc", "cmax"] }
  ],
  "color": { "kind": "variable", "variableId": "sex" },
  "fitByColor": true,
  "distribution": {
    "linkage": "mirror_scatter_grid",
    "colorDistShapes": true
  },
  "observedGroupVariableId": "sex"
}
```

### Snapshot 2 — Guided-like endpoint × exposure, color by endpoint

```json
{
  "mode": "advanced",
  "rowDimensions": [{ "kind": "endpoints", "ids": ["icgi", "icgi2"], "order": ["icgi", "icgi2"] }],
  "colDimensions": [{ "kind": "xMetrics", "ids": ["auc"], "order": ["auc"] }],
  "color": { "kind": "endpoints" },
  "fitByColor": true,
  "endpointOverlay": false,
  "distribution": {
    "linkage": "shared_by_x_column",
    "colorDistShapes": true
  }
}
```

### Guided default (endpoint rows, AUC + Cmax)

```json
{
  "mode": "guided",
  "rowDimensions": [{ "kind": "endpoints", "ids": ["icgi"], "order": ["icgi"] }],
  "colDimensions": [{ "kind": "xMetrics", "ids": ["auc", "cmax"], "order": ["auc", "cmax"] }],
  "color": { "kind": "dose" },
  "fitByColor": false,
  "distribution": { "linkage": "shared_by_x_column", "colorDistShapes": false }
}
```

## GroupKey

All per-group stats (splits, distribution bins, observed bins, fits) should share one enumeration of facet + color keys — see [`docs/RENDERER_ARCHITECTURE.md`](RENDERER_ARCHITECTURE.md) §7.

## Endpoint overlay vs endpoint facets (Advanced)

**Overlay endpoints (compare)** is a Guided-style shortcut: one scatter cell per x-metric column with multiple endpoints drawn together (`endpointIds` on the panel).

In **Advanced**, if **Endpoints** appear in **Facet rows** or **Facet columns**, overlay is ignored (`effectiveEndpointOverlay` in domain). The UI disables the overlay checkbox when an endpoint facet is selected and clears `endpointOverlay` when reading the Style form.

Do not expect “overlay + endpoint column facet” to duplicate compare panels — that was a bug; facet split wins.

## Known issues (parked — not blocking deploy)

These combinations still need UX polish and/or automated coverage beyond enumeration tests:

| Area | Symptom / gap |
|------|----------------|
| **Distribution coloring** | No explicit “color dist by dose / match scatter / none” control; behavior follows `colorDistShapes` and `color.kind`. When scatter color is not dose, dist may still look dose-like unless shapes/color flags align. |
| **Mirror + multi-row facets** | Mirror scatter duplicates dist per scatter row; edge cases with overlay + mirror need manual QA. |
| **Projections** | Click must target the **visible** boxplot row for that facet + color slice, not a pooled/joint row. Logic lives in `apps/demo/src/main.ts`; not covered by Vitest yet. |
| **Projection accent color** | Dose-colored projections only when `color.kind === "dose"`; endpoint/covariate coloring uses `doseProjectionAccent` — verify manually when changing color encoding. |
| **Continuous covariates on facets** | Median/tertile/quartile bins apply to color and faceting; odd layouts (same variable on row + color) need manual smoke. |
| **Full UI matrix** | Style tab + Analysis selections + filters: enumeration tests do not drive the DOM. |

File bugs against specific `ViewLayoutSpec` JSON snapshots when possible (see examples above).

## Verification

### Automated (local or CI)

After building `@er-explorer/domain` (tests import runtime helpers):

```powershell
pnpm --filter @er-explorer/data test
```

[`packages/data/src/viewLayoutEnumerate.test.ts`](../packages/data/src/viewLayoutEnumerate.test.ts) — panel counts, overlay vs endpoint column facet, dist `readoutEndpointId`, Guided adapter parity.

Full demo build (same order as GitHub Pages):

```powershell
node apps/demo/scripts/verify-build.mjs
```

### GitHub Pages

Every push to **`main`** runs [`.github/workflows/deploy-demo.yml`](../.github/workflows/deploy-demo.yml): install → `tsc` all workspace packages → `build-data.mjs` → typecheck `apps/demo` → `build.mjs` → publish **`apps/demo/dist/`** (single self-contained `index.html`).

- **`apps/demo/dist/` and `data.generated.ts` are not committed** — the site is always rebuilt in CI.
- If the live link looks stale, check **Actions → Deploy demo to GitHub Pages** on the latest `main` commit (workflow can also be re-run manually).
- Requires **Node 22** and **pnpm 11** (pinned in root `package.json`), matching [BUILD.md](./BUILD.md).

### Manual smoke

- Toggle **Advanced**, **Reset to match Guided**, compare to Guided mode.
- Advanced: endpoints on **columns**, color by endpoint, mirror facets — expect **split** columns, not duplicate “ENDPOINTS OVERLAID”.
- Click a dose row on a **color-split** dist panel; readout/projections should follow that panel’s cohort.
