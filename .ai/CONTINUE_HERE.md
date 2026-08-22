# Continue here (session handoff)

**Last updated:** 2026-08-16 (uncommitted: policy fix + ADR-0012 + rethink docs)  
**Theme:** **ENCODING V2 APPROVED** — unified grammar (ADR-0012 in `docs/DECISIONS.md`); full design record in [`ENCODING_V2_RETHINK.md`](./ENCODING_V2_RETHINK.md). The Phase-2 backlog below is **subsumed** by the v2 implementation sequence (rethink §F). Old plan kept for reference only.  
**Git:** Uncommitted on `main`: `panelVisualPolicy` multiCurve fix (+test), ADR-0012, `.ai` updates; exclude local `claudetwoexposureoneendpoint.R` from commits.

**Progress (2026-08-16, committed on main):**
- `301ceab` §F step 2: domain `cellContext.ts` (`resolveCellContext` — one-channel rule, curve/observed groups, dist-row policy, metricPopulation split scope) + `viewSelection.ts` (serializable selection, `dose|suffix` parse/format) + 13-test matrix.
- `08685ad` step 3a: data `cellResolution.ts` — `createCellResolver` (bin model built ONCE on base cohort) + 5 tests.
- `e087df2` step 3b: dist strip palette via resolver — **unsplit rows neutral under color=endpoints** (ADR-0012 §I.1); `distEndpointAccent` heuristic deleted; `distUsesEndpointColorWhenUnsplit` deprecated; ui-smoke step 2 updated to neutral contract.
- `0726eeb` step 3c: **continuous endpoints fit per color level** (BRLS bug fixed) — `renderContinuousScatterViaRenderer` takes curve groups + point color resolver; per-curve fitted markers at splits; degenerate facet+color panels wear their level color; ui-smoke step 5 added.

**QA round 3 findings (2026-08-16 screenshots — user-confirmed symptoms → root causes):**
- Continuous scatter points/curve ignore `endpointMonochrome`: BRLS panel under color=endpoints shows DOSE-rainbow points and a gray curve (point color hardcoded to dose palette in continuous branch; curve color only overridden for color=variable).
- Binary/compare projections still dose-colored (violet 2400 mg bands) regardless of channel — `projectedGroupsFor`/binary path never unified with `resolveDoseRowPaint`.
- Projection quantile stats computed GLOBALLY (`recordsWithEndpoint` + active set), not per panel cohort → projected band does not match the clicked (facet-filtered) boxplot; per-endpoint missingness also makes BRLS band start left of ICGI's.
- Stale selection: `selectedDistGroupIds` survive layout changes with orphaned group ids — impossible to unselect.
- **USER DECISION: dose is NOT special.** Remove the fitByColor-for-dose exception (user responsibility); dose behaves as an ordinary categorical color channel (levels = arms). Only remaining dose-specific rules: dist rows organized by dose; PK placebo exclusion (data rules, not encoding).

**Plan progress (each slice committed + smoke-extended):**
1. ✅ **Slice A** (`00105d8`): one-channel law in every color decider — continuous endpointMonochrome points + endpoint curve; `colorForDistGroupId` plain-dose tail → neutral unless color=dose; `doseProjectionAccent` → neutral; binary endpointMonochrome accent → neutral; degenerate level color passed as colorOverride; continuous projection stats on the PANEL cohort. Smoke #6: monochrome continuous points.
2. ✅ **Slice B** (`00105d8`): dose de-specialized — fitByColor legal for color=dose (per-arm curves, binary + continuous + resolver `doseLevels`/`doseForRow`); UI disable + status message removed.
3. ◐ **Slice C1** (`08d1756`): selection invariant — rendered dist group ids collected per paint pass; orphaned selections pruned with one guarded re-render (kills ghost projections/stuck rows).
3b. ✅ (`0c75568`) QA round 4 fixes: **continuous split-row projections existed nowhere** — `projectedLinearGroupsForDistSelection` now mirrors the binary path (same `rowsForDistGroupId` row resolution: dose ∩ level/endpoint ∩ panel cohort; same `colorForDistGroupId` one-channel color; mean±CI stats). Also killed TWO hidden fitByColor strippers (`advancedLayoutUi.readAdvancedSpecFromUi`, `viewLayoutState.normalizeAdvancedColorFit`) that silently deleted the flag for color=dose — why "fit separately per arm" looked broken; both now strip only for color=endpoints (vacuous there).
3c. ✅ (`c64718a`) **Readout unified with the selection pipeline** — rows via `rowsForDistGroupId` (dose ∩ level/endpoint ∩ panel cohort), one-channel colors via `colorForDistGroupId`, split rows labeled `dose · level`, fit values from the same group as the plotted curve (per level/arm under fitByColor) — never the global fit. Also fixed dose labels vanishing on split strips in later-level facets (label now on first SURVIVING sub-row; user QA round 5).
3d. ✅ QA round 6: multi-curve cells (paintCompareScatterIntoWrap) projected GLOBAL stats in faceted grids — identical 34/37 in every sex panel. Panel cohort now threaded into computeBinaryDoseGroupStats / computeContinuousDoseGroupStats / projectedGroupsFor there.
   **C2 remaining:** mechanical `ViewSelection` type swap (~40 sites in main.ts) + `.erx` persistence of spec+selection (break approved).
   **Slice E note:** in compare cells, LINEAR endpoints' split-row (`dose|level`) clicks still project pooled-dose stats (`projectedLinearGroupsFor` has no dist-selection dispatch; shape mismatch ProjectedGroup vs LinearProjectedGroup) — resolve when the compare painter is converged into the regular path (E), not by patching.
   **Selection semantics: CONFIRMED by user** — group-id selection is global (highlighted in every facet, each panel projecting its own cohort).
3h. ✅ (`2d82174`) **Nested facet binning on BASE cohort**: `expandDimension` binned wt inside each study branch (per-study medians) while color binned globally → wrong-color points inside binned facet panels (user QA round 9). Model now built on base-cohort indices; branch indices only for membership. Data test: study×binned-wt nesting with global cut.
3g. ✅ (`d3b14f3`) **Implicit facets are DERIVED, never sticky**: `implicit: true` on `LayoutDimension`; stripped+recomputed each `ensureScaleBearingFacets` call; hidden from `applyFacetSelectFromSpec` (UI never adopts them); `dedupeFacetDimensions` lets any authored dim beat an implicit one across axes (columns win only between authored). Fixes: implicit metrics column blocked moving metrics to rows (user QA round 8).
3f. ✅ (`ae4176b`) **Scale-bearing rule ENFORCED** (`ensureScaleBearingFacets`, domain): >1 metric with no metric facet → implicit xMetrics columns (was: AUC silently dropped); >1 endpoint unfaceted and not color=endpoints overlay → implicit endpoint rows. Symmetric enumeration bug fixed too (fallback branch injected xMetric, clobbering metrics-as-rows → duplicated first metric); the synthetic no-columns branch now contributes NOTHING to the facet key.
3e. ✅ (`1464990`) **Endpoint-row facets fixed**: the synthetic no-columns branch in `enumerateScatterPanels` injected `endpoint=first` and the column-last merge clobbered row-faceted endpoints — "endpoints as rows" with one metric collapsed to duplicated first-endpoint panels. Rule: a fallback branch only contributes the axis it owns (x). Also: selection registry cleared per mounted layout (render()), not per synced pass. Smoke hardened (distinct endpoint stacks; per-panel monochrome — which closed the #ddaa33 mystery: that panel WAS icgi2's, correctly colored).
3j. ✅ (`dd07abe`) **QA round 10 — projection/curve association fixed**: (a) `projectedGroupsForDistSelection` binned color var on PANEL cohort (last re-binning site; clicked N=6 row projected as 8/9) → base cohort; (b) binary fit-per-level curves each carried the FULL projected array → duplicate callouts + blue band on orange curve → per-curve level filtering; (c) continuous multi-curve projections used first curve's samples → overlays carry `level`, groups project onto matching curve; (d) binary selection stats now endpoint-finite (parity with linear). NOTE explained to user: strip N (exposure rows) vs projection N (endpoint-finite rows) legitimately differ under missingness; icgi vs icgi7 band extents differ for the same clicked group for the same reason.
3i. ✅ (`ee73fe7`) **C2 persistence DONE**: domain `ViewSelection` is the serialized selection contract in sessions — split-row selections (`dose×endpoint`, `dose×level`) survive reload as structured `DistGroupRef`s; legacy `selectedDoses` array kept as fallback. Combined with persisted `ViewLayoutSpec`, Advanced layout + split selection replays fully. The remaining C2 item — renaming the two runtime Sets to a single `ViewSelection` field — is a pure mechanical rename with no behavior; fold it into Slice E's main.ts shrink.
**READ FIRST when resuming: [`INVARIANTS.md`](./INVARIANTS.md)** (I1–I7 — bug classes + guards) and ADR-0013 (model-family adapter contract) in `docs/DECISIONS.md`.

4. ✅ **Slice D DONE** (`be2e147` + title fix): dist cells collapse over the endpoint dimension in `enumerateDistPanels` (`distCollapseKey` = xMetric + non-endpoint facet parts) — per-endpoint strips were exact duplicates by construction since unsplit rows are not endpoint-filtered. Mount derives placement (one dist grid per non-endpoint row slice; single shared grid when none) — no more linkage branching, no duplicated/overlapping strips. `readoutEndpointIds` = all endpoints sharing the strip (readout keeps one fit line per endpoint). Distribution-layout dropdown pinned to constant + hidden (delete with Slice E wiring cleanup). Dist titles from the panel's own endpoint-free facet key. Smoke asserts strips never duplicate per endpoint.
   **Note for E:** `DistributionLinkage` type + spec field remain for session compat but are semantically dead — remove field + type + hidden select together in E.
**REORDERED (2026-08-19): F precedes E's compare convergence.** Converging the compare painter requires rendering mixed-family cells (binary + rescaled linear on one axis) through one painter; without adapters that re-implements family branching ad hoc. Sequence:

5. **Slice F — ADR-0013 family adapters** (F1–F3 ✅):
   - F1 (`ba0a065`): adapter interface (domain) + logistic/linear families + `updateReadout` converted.
   - F2/F3 (`a190ee0`, `99df184`): `ProjectedGroup.observed/observedMean` → one `observedSummary: ObservedGroupSummary`; `LinearProjectedGroup` aliased; all six projected producers + both renderer consumer blocks converted. `ObservedResponseBin`/`ObservedMeanBin` → one `ObservedBin {x, summary}`; twin computors + twin ForPanel wrappers merged (`computeObservedBins[ForPanel]`, canonical level order). **Correctness change:** binary bins/groups are now endpoint-finite like continuous (missing ≠ non-responder) — binary Ns shift where endpoint has missingness. Compare overlay rescales summary geometry to 0–1, labels native. `observedFamilyFor(endpoint)` = TYPE-driven selector (decision 4a). Net −240 lines.
   - Also (`6a09179`): pooled-arm clicks project onto EVERY curve (neutral window per curve, one callout); canonical level order in both scatter branches (was Set-insertion order → per-panel curve-host flip, user QA round 10).
   - (`b5fba7f`) **I8 granularity rule:** pooled selections expand to curve granularity (projectionGidsAtCurveGranularity); pooled-window mechanism + continuous dose-branch fallback DELETED; every selection routes through the one dist-selection pipeline. See INVARIANTS.md I8.
   - ✅ **F4 (integration level)** (`582d836` + widened): conformance matrix in ui-smoke #7 — THREE scenarios (pooled→I8 expansion; level-row→own curve; pooled-curve→neutral exact #475569), each asserted structurally identical across binary/continuous. Unit-level matrix requires pipeline extraction — lands with Slice E, do not hack it into main.ts before. Old note: conformance matrix (same facet×color×split×click scenario per family, structural assertions). KPI status cards still call wilson/meanCI directly (not chart pipeline — convert in E).
6. **Slice E — consolidation (after F3):** compare-painter convergence into the single paint path (mixed-family cells via adapters + explicit rescale; fixes linear split-row projections in compare cells), guided presets P1–P3 (delete overlay mount + compare booleans + dead `DistributionLinkage` field/type/hidden select), split-bin callout declutter, smoke matrix additions (facet-panels-differ, facet order, one-curve-per-degenerate-panel).
   **DECISION (recorded):** the runtime `selectedDoses`/`selectedDistGroupIds` Sets stay as the demo's internal mirror of the domain `ViewSelection` (the boundary contract for sessions/semantics). A 43-site mechanical rename adds no behavior; revisit only if the mirror ever drifts (pruning + click handler are the only writers).

Known cosmetic to verify in D/E QA: smoke #6 reports point fill `#ddaa33` for the brls-only panel (expected `#55a868`) — endpoint accent may resolve via a fallback panel; check `endpointIdForDistPanel`/panel endpoint wiring when touching dist geometry.

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
