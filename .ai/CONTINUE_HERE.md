# Continue here (session handoff)

**Last updated:** 2026-08-16 (uncommitted: policy fix + ADR-0012 + rethink docs)  
**Theme:** **ENCODING V2 APPROVED** — unified grammar (ADR-0012 in `docs/DECISIONS.md`); full design record in [`ENCODING_V2_RETHINK.md`](./ENCODING_V2_RETHINK.md). The Phase-2 backlog below is **subsumed** by the v2 implementation sequence (rethink §F). Old plan kept for reference only.  
**Git:** Uncommitted on `main`: `panelVisualPolicy` multiCurve fix (+test), ADR-0012, `.ai` updates; exclude local `claudetwoexposureoneendpoint.R` from commits.

**Next session: start at `ENCODING_V2_RETHINK.md` §F step 2** — domain resolver (`resolveCellContexts`) + selection type + test matrix. User approved ("go", 2026-08-16); all design questions closed (§H/§I).

---

## Start next session (5 min)

1. Read this file + [`OVERLAYS_AND_SPLITS.md`](./OVERLAYS_AND_SPLITS.md) (overlay cohort — ADR-0011 implemented in domain + demo paint).
2. Skim [`LAYOUT_AND_ENCODING.md`](./LAYOUT_AND_ENCODING.md).
3. Build and smoke:

```powershell
cd "c:\Users\smouksas\OneDrive - Certara\Desktop\packages\er-explorer"
node apps/demo/scripts/verify-build.mjs
pnpm --filter @er-explorer/domain test
pnpm --filter @er-explorer/demo smoke:ui
```

3. Manual spot-check in `apps/demo/dist/index.html` (hard refresh):
   - Guided: Compare endpoints → toggle **Split distribution by endpoint** (dist should reflow without leaving compare).
   - Advanced: endpoints faceted + **Color: Endpoints** + **Mirror scatter facets** → boxplots **one endpoint color per strip** (not dose rainbow).
   - Advanced: **Color: wt** (or sex) + **Color-split boxplots** → click a split row → scatter projection matches **that subgroup**, not whole dose.

---

## Completed (do not re-litigate unless broken)

### Phase 0 — ADR

- **ADR-0010** in [`docs/DECISIONS.md`](../docs/DECISIONS.md): layout visual encoding, policy in domain, multi-curve cells via `endpointIds`.

### Phase 1 — Domain policy

| Artifact | Role |
|----------|------|
| `packages/domain/src/panelVisualPolicy.ts` | `resolvePanelVisualPolicy`, `resolveDistVisualContext`, `resolveLegendShowsEndpoints` |
| `packages/domain/src/panelVisualPolicy.test.ts` | Policy cases incl. faceted endpoint + `distUsesEndpointColorWhenUnsplit` |
| `apps/demo/src/layout/resolvePanelStyle.ts` | Thin helpers: policy from panel id / layout chrome |

### Demo wiring (2026-08-07)

| Area | Change |
|------|--------|
| **Guided compare** | `compareDistByEndpoint` → **`render()`** (not `refreshSelectionVisuals` only). Split checkbox **hidden** unless Compare endpoints on. |
| **Linked x-domain** | `xDomainForLinkedPanels` unions all panels sharing same **x metric column** (sex/study rows share axis). |
| **Advanced color × facet** | Covariate on facets → color dropdown disables that var; paint falls back to dose within panel. |
| **Endpoint dist color** | When `color=endpoints` and unsplit dist: `distEndpointId` / `distUsesEndpointColorWhenUnsplit` → boxplots use panel endpoint color. |
| **Color-split UI** | `syncAdvancedColorDistShapesUi`: disabled when endpoints faceted or color=dose; hints in `index.html`. |
| **Subgroup projections** | Click `dose\|level` or `dose\|endpoint` → `projectedGroupsForDistSelection` uses **same rows** as dist row; projection color matches subgroup. |
| **UI smoke** | `apps/demo/scripts/ui-smoke.mjs`, `pnpm --filter @er-explorer/demo smoke:ui`, Playwright devDep on demo package. |

---

## Phase 2 — next (approved direction, not started)

**Priority (2026-08-08):** Overlay cohort scope — **in progress** (see [`OVERLAYS_AND_SPLITS.md`](./OVERLAYS_AND_SPLITS.md)). Verify sex-facet + color-by-sex manually; extend ui-smoke if needed.

1. **Selection model in domain** — one type for `selectedDoses` + `selectedDistGroupIds`; derive readout/projections from spec + selection (move logic out of `main.ts` filters).
2. **Guided presets only** — `compareEndpoints` / `compareDistByEndpoint` write/read `ViewLayoutSpec` via `guidedToViewLayoutSpec`; reduce parallel booleans.
3. **Session persistence** — full Advanced spec + dist selection in `.erx`.
4. **Tests** — extend smoke for: endpoint-facet dist colors; covariate split click → projection color; optional readout assertions.
5. **Extract paint** — shrink `main.ts` using policy + `resolvePanelStyle` (no second compare paint path long-term).

See [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) Critical/Important items.

---

## User-facing cheat sheet (support)

### Boxplots colored by endpoint

- **Style → Advanced**
- **Color curves / dist → Endpoints**
- Facet endpoints on rows/columns as needed
- **Distribution layout → Mirror scatter facets**
- **Do not** expect “Color-split boxplots” when endpoints are faceted (one endpoint per panel → automatic endpoint color on strip; split checkbox is disabled).

### Projections by color subgroup (wt, sex, etc.)

- **Color** = covariate, **Color-split boxplots** on
- Click a **split** row (`dose|level`), not pooled dose-only behavior
- **Fit separately per color group** = multiple **curves**, not projection cohort (projections follow **clicked dist row**)

### Linked axes across facet rows

- X-axis limits are shared per **exposure column** (all rows for same AUC/CMAX column).

---

## Key files touched recently

```
packages/domain/src/panelVisualPolicy.ts
packages/domain/src/panelVisualPolicy.test.ts
apps/demo/src/main.ts                    # large: paint, selection, projections, advanced UI sync
apps/demo/src/layout/resolvePanelStyle.ts
apps/demo/src/viewLayoutState.ts         # layoutColorFacetConflict copy
apps/demo/index.html                     # Advanced hints
apps/demo/scripts/ui-smoke.mjs
apps/demo/package.json                   # smoke:ui, playwright devDep
docs/BUILD.md                            # automated UI smoke section
docs/DECISIONS.md                        # ADR-0010
.ai/*                                    # this handoff
```

---

## Fixed 2026-08-13 (uncommitted — verify then commit)

- **BUG:** `distUsesEndpointColorWhenUnsplit` was `true` for **multi-curve** overlay panels → Guided compare with split OFF painted **all** dose boxplots in one endpoint accent (icgi blue), instead of dose colors. Fix: policy now requires `!multiCurve` ([`panelVisualPolicy.ts`](../packages/domain/src/panelVisualPolicy.ts)); test expectation at "color endpoints without split → dose dist" corrected to `false` (test name always said dose dist). `smoke:ui` green again.
- **Known cosmetic:** bundled dataset gained `icgi7`, which is not in `ENDPOINT_COLORS` (main.ts) → palette-index fallback gives it `#DDAA33`, colliding with `icgi2`'s hardcoded `#DDAA33`. Fix separately (dedupe fallback against hardcoded map).

## Open / verify on next visit

- [x] **BUG (partial fix):** Overlays cohort-aware — `resolveOverlayCohortPolicy`, `rowIndicesForReferenceSplit`, panel cohort for observed/Min-Max; split x still endpoint×metric. Manual QA: sex facet callouts differ; color-by-sex callouts per level.
- [ ] Endpoints on **both** row and column facets — confirm dist colors on all panels.
- [ ] Readout panel when split selection: may still summarize by **dose** only.
