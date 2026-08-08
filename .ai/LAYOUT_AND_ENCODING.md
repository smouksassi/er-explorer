# Layout, encoding, and selection (technical debt)

**Goal:** Endpoint is a **grouping variable like any other**—facet by endpoint, color by endpoint, linetype by endpoint—user responsible for sensible combinations. Guided “Compare endpoints” is a **preset**, not a separate architecture.

**Spec type:** `ViewLayoutSpec` in `@er-explorer/domain`; enumeration in `@er-explorer/data/viewLayoutEnumerate.ts`; mount/paint in `apps/demo` (`renderViewLayout.ts`, `main.ts`).

## Target mental model

| Knob | Meaning |
|------|---------|
| Analysis: exposures / endpoints | Which measures are in play (ids only in Advanced sync) |
| Facet rows / columns | `LayoutDimension`: endpoints, xMetrics, variable |
| Color | `ColorEncoding`: dose, endpoints, variable (+ optional `fitByColor`) |
| Dist split | `distribution.colorDistShapes` + linkage—not a Guided-only concept long-term |
| Multi-curve in one cell | `ScatterPanelSpec.endpointIds` when color=endpoints and endpoint not faceted |

**No** Advanced “overlay/compare” checkbox long-term; `endpointOverlay` is Guided compare preset only (`isGuidedCompareTopology`).

## Parallel systems today (avoid extending)

| Guided | Advanced / spec | Problem |
|--------|------------------|---------|
| `compareEndpoints` | `color.kind === "endpoints"` | Two ways to enable multi-curve |
| `compareDistByEndpoint` | `distribution.colorDistShapes` | Split dist not purely spec-driven |
| `endpointOverlay` | facet grid + `endpointIds` | Overlay mount branch vs grid |
| `isEndpointComparisonActive()` | `layoutUsesNeutralDoseChrome()` + policy | Neutral dose labels in chrome only when spec says multi-curve + color=endpoints |
| `selectedDoses` | `selectedDistGroupIds` (`dose`, `dose\|endpoint`, `dose\|level`) | Selection not one domain type |

## Known user-visible inconsistencies (2026-08)

**Fixed in demo (2026-08-07 — re-verify after build):**

- Guided **Split distribution by endpoint** toggle without full re-render.
- **Linked x-axis** across facet rows (same exposure column).
- **Color = covariate** when covariate is also a facet → dose fallback + disabled color option.
- **Color = endpoints** + endpoint facets → dist strip uses **endpoint color** (`distUsesEndpointColorWhenUnsplit`).
- **Color-split dist click** → projections use **subgroup rows** (`projectedGroupsForDistSelection`), not pooled dose.

**Still open / Phase 2:**

- Unified **selection** type in domain; readout text may not fully match subgroup selection.
- Guided booleans vs spec-only persistence.
- Further dedupe of compare-specific paint in `main.ts`.

## Direction (approved conceptually; implement incrementally)

**Phase 0+1 (done):** ADR-0010 in `docs/DECISIONS.md`; `resolvePanelVisualPolicy` / `resolveDistVisualContext` / `resolveLegendShowsEndpoints` in `@er-explorer/domain`; demo wired via `apps/demo/src/layout/resolvePanelStyle.ts` and `main.ts`. **Verified:** `pnpm --filter @er-explorer/demo smoke:ui` (2026-08-07).

**Phase 1b demo UX (2026-08-07, same branch — see `.ai/CONTINUE_HERE.md`):** linked x-domain, Guided dist toggle, endpoint-colored dist when faceted, covariate-split projections, Advanced color/dist UI sync, `ui-smoke.mjs`.

1. **Domain:** Serializable **selection** + derive dist split / curve count from spec only (reduce booleans).
2. **Data:** Single enumeration path; `attachMultiEndpointIds`; no Advanced overlay branch.
3. **Demo:** `resolvePanelStyle(spec, panel)` → colors, dash, dist split; one scatter paint path; remove neutral-dist except when encoding is dose and unsplit.
4. **Session:** Persist full `ViewLayoutSpec` + selection; migrate Guided booleans to presets writing spec.
5. **Optional:** `LineStyleEncoding` (endpoint dash) in spec, not hardcoded in compare paint only.

## Key files

- `packages/domain/src/viewLayout.ts`
- `packages/data/src/viewLayoutEnumerate.ts` (+ tests)
- `apps/demo/src/guidedViewLayout.ts`, `viewLayoutState.ts`, `advancedLayoutUi.ts`
- `apps/demo/src/renderViewLayout.ts`
- `apps/demo/src/main.ts` (paint, selection, readout—extract slowly)

## Tests to extend when changing behavior

- `packages/data/src/viewLayoutEnumerate.test.ts` — topology, `endpointIds`, study×x×color
- Future: golden or DOM-light tests for `resolvePanelStyle` if extracted from demo
