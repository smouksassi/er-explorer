# Continue here (session handoff)

**Last updated:** 2026-08-07 (end of day)  
**Theme:** Layout visual policy (Phase 0+1) + demo UX fixes (Guided compare dist, linked x-axes, endpoint/covariate dist + projections).  
**Git:** Changes are **local** — user did not request a commit; run `git status` before starting.

---

## Start next session (5 min)

1. Read this file + skim [`LAYOUT_AND_ENCODING.md`](./LAYOUT_AND_ENCODING.md).
2. Build and smoke:

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

## Open / verify on next visit

- [ ] User screenshot showed **old** status text (“Use Color: Dose…”) — ensure **rebuilt dist**; status string was updated in `updateAdvancedLayoutStatus`.
- [ ] Endpoints on **both** row and column facets (unusual grid) — confirm dist `readoutEndpointId` and colors on all 6 panels.
- [ ] Readout panel when split selection: may still summarize by **dose** only; align readout with subgroup if user asks.
- [ ] `pnpm-lock.yaml` may include Playwright from smoke setup — intentional for CI/local smoke.

---

## Do not commit without user ask

Per project rules: no git commit/push unless explicitly requested. When ready, suggested scope: **one PR** — “layout policy Phase 0+1 + demo dist/selection UX” (exclude unrelated root junk like installer zips).
