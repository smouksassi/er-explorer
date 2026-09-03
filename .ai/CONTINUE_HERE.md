# Continue here (session handoff)

**Last updated:** 2026-08-24 — **E2a LANDED: grouping model cutover (§J / I10).**
`grouping: { variableIds }` replaces `fitByColor` everywhere (UI "Group curves
by" select; `resolveGrouping` migrates persisted legacy specs at
`resolveViewLayoutSpec`); curves = endpoint × grouping partition; constancy
theorem paints curves AND projections (one law — `constantOver`/`curveColorKey`);
projections associate with curves structurally via `curveKey` (id-string parsing
removed from the association path); readout mirrors curve granularity (only
snapshot diff: s6 readout — the old pooled fit line under split curves was a
latent I8 violation, re-baselined). New capabilities now legal by grammar:
grouping by a NON-painted variable (identical-looking curves — user's
responsibility), grouping under color=endpoints, dose-faceted degenerate
arm-colored curves. Invariants I8 restated + I10 added.
**P1–P4 LANDED (2026-08-24, commits 878a10b / 699d53c / 651190c) — all four
items from the user's post-E2 visual pass:**
- P1 no-extrapolation for curves: `curveFor` clips to the fit cohort's exposure
  support; single-exposure groups (placebo) render a fitted point + CI marker,
  never a full-width line ("zero stays at zero").
- P2 label dedup: `selectionGroupLabel` drops key parts already in the row's
  identity ("2400 mg · 1 · 2400 mg" → "2400 mg · 1"); readout uses the same
  composer.
- P4 content-aware strips: inline min-height = rows×18px+margins per dist
  chart; cells scroll (never clip/overprint); two legacy `!important
  min-height:0` rules demoted.
- P3 Guided desync ROOT-FIXED, probe-verified (tick x 605.0==605.0 before/after
  click and with expanded readout): gutter parity on ALL panel cells,
  collapsed readout reserves 3.25rem, resize observer watches chart boxes.
NEXT: user visual pass on P1–P4, then E2c painter convergence, E3 P1
(per-endpoint-column strips), E4 presets/dead-code, E5 linetype, E6 callouts.

**E2c + E3 P1 LANDED (2026-08-24, b70db44 / 7942402) — E2 COMPLETE:**
- E2c painter convergence: compare cells run on the shared §J partition
  builder (`curvePartitionsForRows` — grouping now works in overlay cells) and
  the ONE selection pipeline; DELETED (−281 lines): renderScatterPanel (dead),
  computeBinary/ContinuousDoseGroupStats, projectedGroupsFor,
  projectedLinearGroupsFor, doseProjectionAccent, deprecated aliases. ALL SIX
  baselines reproduced BYTE-IDENTICAL after the swap.
- Known edge (logged, not built): a linear endpoint with degenerate norm
  bounds (constant endpoint) in a shared-axis cell fails soft (NaN points);
  the "implicit facet for unscaled linear" only matters if an explicit
  "no rescale" option is ever added.
- E3 P1: endpoint COLUMNS get one column-aligned strip each (own title, own
  single-endpoint readout); endpoint ROWS still collapse (P2). Snapshot s7
  pins it; s1–s6 byte-identical.
NEXT: user visual pass (endpoint-column strips + compare cells with grouping),
then E4 (guided presets + dead compare booleans/overlay mount + retired
DistributionLinkage), E5 linetype channel, E6 callout density control.

**E4 LANDED (2026-08-24, 3379805 + fdd3ca4) — user confirmed E2c/E3 visuals:**
- E4a one path (rethink A4): guided-compare special branches DELETED from both
  enumerateScatterPanels and mountViewLayoutGrid — overlay flows through the
  general grid ("|overlay" id suffix and the banner label gone; s1–s3
  re-baselined, text-identical, +20px chart height).
- E4b presets: ONE "Guided preset" select (endpoint-rows | exposure-rows |
  overlay) replaces gridLayout select + compareEndpoints checkbox; state fields
  deleted; sessions save guidedPreset with legacy migration on load; "Split
  distribution by endpoint" remains the overlay sub-option. All 7 baselines
  byte-identical.
- Still vestigial (harmless, future sweep): spec.endpointOverlay flag,
  DistributionLinkage select (hidden), isGuidedCompareTopology (still used by
  panel-policy chrome), GuidedGridLayout type.
NEXT: E5 linetype channel (user-requested; motivating case: facet+color=crcl,
group=sex — dash distinguishes the sex curves), then E6 callout density.

**E4 polish + E5 LANDED (2026-08-28):** guided preset radios + split-dist
toggle relocated (user feedback); E5 linetype channel: spec.linetype
(none | endpoints | variable, default endpoints = legacy dash rule preserved,
all 7 prior baselines byte-identical), constancy-law dash in ALL painters
(regular continuous/binary + compare), "Linetype (curves)" select in Style,
dash legend when mapped to a variable, snapshot s8 pins the motivating case
(crcl facet+color + group/linetype=sex: solid vs "8 5" per panel).
NEXT: E6 callout density control (default "Selected groups only", "All" on
demand, persisted); then backlog: rethink §K provenance check (177 vs 176),
"recode value as missing" data-prep feature, vestigial sweep (endpointOverlay
flag, DistributionLinkage, GuidedGridLayout type).

**E6 LANDED (2026-08-28) — E-SEQUENCE COMPLETE (E1–E6):** callout density
control in Overlays (state.calloutDensity, persisted, legacy-safe load).
Rule: per-group split/bin callouts (observed %/N per color level, fitted+CI
per curve, fitted-at-bin) follow the SELECTION by default — a curve shows its
fit pill iff it hosts a projection (the I8 association); pooled dose click →
all groups; NO selection → cohort level only (pooled observed; fit pill only
on a lone pooled curve). "All groups" = legacy everything-on. Probe: 6 hit-
areas (selected/noSel) vs 42 (pooled click) vs 36 (all/noSel); snapshots
s9/s10 pin both densities. NOTE: the snapshot battery loads WITHOUT example
defaults, so s1–s8 never had split callouts — all byte-identical.
REMAINING BACKLOG: user visual pass on E5+E6; provenance check (177 vs 176);
"recode value as missing" data-prep; vestigial sweep; E3 strip-rule
re-challenge (user reserved the right); ordinal/Emax family adapters
(ADR-0013 lookahead); CUI work (long-term).

**LEVEL RECODING LANDED (2026-08-28, user-approved design):** per-variable
categorical recode (merge rare levels, rename, route coded values e.g. race 99
→ (missing), drag display order) in Data drawer. Applied INSIDE the one level
model (I1: data/variableBins WeakMap registry — setVariableRecodes on the
loaded dataset), so colors/facets/grouping/linetype/strips/filters/readouts
all see recoded identity with zero plumbing; recoded-to-missing rides I9;
filters speak recoded levels ONLY (user ruling) and recoded-to-missing counts
as missing there too. Covariates only (dose machinery reads raw arm labels;
endpoints are numeric). In-place + reversible (Reset), persisted in sessions.
Data tests (merge/rename/missing-route/order incl. partial order); snapshot
s11 pins race merged 2+3 / 4+5 / 99→missing end to end.
**REFERENCE-ARM + PK SLICE LANDED (2026-08-28):** free-text reference-arm
input replaced by a CHECKBOX picker of the dose column's actual levels
(typo-proof; legacy/session tokens that match no level surface a warning,
never silently dropped). Inferred defaults MATERIALIZE into an explicit
selection on dataset activation, so "all unticked" now genuinely means NO
reference arm (isPlaceboDose no longer re-infers). "How reference arms are
handled" explanation lives under the picker (PK: excluded from cuts/Min-Max,
own %/N callout at 0, no all-zero boxplot; non-PK: ordinary data; covariate
binning always includes the arm). NEW "Exposure handling (PK vs non-PK)"
list: auto-detected badge per exposure (name / zero-arm reason) + per-column
user override (state.exposurePkOverrides, persisted); roles summary shows
"exposure · PK / NON-PK". All 11 baselines byte-identical.

**LOESS LANDED (2026-08-31, 990d0ac) — ADR-0013's contract PROVEN:** third
model family with NO pipeline changes. packages/model-loess (R stats::loess
match under surface="direct"; CI = SE×t; null below 5 points). Painter path
now follows DATA KIND (endpointDataKind), not the model — usesLinearModel
deleted; loess legal on binary (x/N observed stays, axis pads, never clamps).
Endpoint Models UI: Logistic|Loess / Linear|Loess + user-owned span/degree,
persisted (loessSettings). Snapshot s12 pins binary+continuous loess with
grouping; s1–s11 byte-identical. Earlier same-day: vestigial sweep (6960e46).
NEXT (superseded — landed below): user visual pass on loess (cross-check in R
with loess.control(surface="direct")).

**UNIFIED MINIMUM-SUPPORT LANDED (2026-09-01) — invariant I11:** the approved
tier table implemented at the central stat seams only (never per painter):
`analysis/support.ts` owns MIN_SUMMARY_N = MIN_FIT_N = 5 + supportTierFor
(full ≥5 / minimal 2–4 / single 1). `summarizeDistribution` is tiered — below
full, q1/q3/whiskers are **NaN** (the abstention encoding; a forgetting
consumer draws nothing, never a lie); min/median/max/mean stay honest.
Dist rows below N=5 render RAW POINTS (renderer `rawPoints` on
DistributionGroupDatum; decided once in computeDistributionGroupData; row keeps
label/N/click/selection). DoseProjectionLayer skips non-finite markers →
abstaining projections show range band + median tick, no Q1–Q3 core (NaN
filter empties it automatically). `tryFitForCohort` is now the ONE fit gate for
EVERY curve path — the pooled continuous curve routed through it too
(renderContinuousScatterViaRenderer accepts curve=null; binary paths already
tolerated zero curves); P1 placebo point marker unaffected (N=244, 1 distinct
x still fits). Readout: minimal → Min·Median·Max + "quartiles need N ≥ 5";
single → the value; fit abstention prints muted "— fit n/a (N=k)" instead of
silently omitting. Observed x/N & mean±CI unchanged (data, not estimates).
Tests: analysis support.test.ts (6), renderer rawPoints + NaN-projection
tests; snapshot s13 pins tiny recoded-race cells end to end (raw-point rows,
tiered readout, fit n/a, zero "NaN" in ALL baselines); s1–s12 byte-identical.
KNOWN PRE-EXISTING (not this slice): collapsed endpoint-ROWS strip readout
prints one endpoint's fit line (see s12 baseline) — old Slice-D open item.

**LINETYPE DASH AUTHORITY FIXED (2026-09-02, user-approved veto) — I10
addendum:** user report "linetype not working" on continuous endpoints,
probe-confirmed: FitLayer's legacy `"7 5"` default + the continuous painter's
`c.dash || undefined` coercion turned the linetype module's `""` (solid) back
into a dash — binary obeyed, continuous didn't (family asymmetry). Fix at the
ROOT: FitLayer has NO dash policy (`""`/null/omitted = solid); painters pass
the linetype output verbatim. USER VETO RECORDED: the classic dashed-gray
pooled curve is GONE — pooled curves are solid in every family ("no difference
between models... can't afford any leaks"). All 13 prior baselines diffed;
every diff machine-verified as exactly two token classes (removed `"7 5"`,
removed dead empty `stroke-dasharray=""` attrs — the old drawTarget emitted
empty attrs) then re-baselined; s14 pins solid/`"8 5"` per sex identically on
icgi AND brls panels. LOESS RULING (same session): the N=5 df=0 interpolant
(race=3 × age>51: enp=5.00, sigma=NaN, no CI ribbon — probe-computed) STAYS
visible; user owns the model choice (switch to linear / raise span); no df
guard. Min-support visual pass CONFIRMED by user (raw-point rows, minimal
projections, loess span sensitivity all OK).
**SHARED-STRIP READOUT FIXED (2026-09-03) — Slice-D open item closed:**
`resolveDistVisualContext` re-derived readout endpoints from a FABRICATED
pseudo-panel (empty facetKey + fallback endpoint); under any endpoint facet
that answered "single", so a strip shared by several endpoint rows read out
only the first endpoint's fit line. Rule now: the strip's readout endpoints
ARE `compareEndpointIds` — the list the enumeration computed (per-column
strip: its own endpoint, E3 P1; collapsed strip: every endpoint merged;
split strip: the split list). Domain tests pin both cases. Baseline diffs
machine-verified READOUT-ONLY (stacks/titles/status byte-identical) in
s6/s12/s13: each clicked group now prints one fit line per endpoint
(endpoint-labeled), incl. per-endpoint "fit n/a" abstentions and per-endpoint
missing-N notes; re-baselined.
NEXT (user directive: "fix any open known bugs before adding functionality"):
1) degenerate norm-bounds linear endpoint in shared-axis cells (E2c logged
edge); 2) loess R cross-check still pending user-side. THEN: Emax family,
provenance check (177 vs 176), E3 re-challenge.

**User feedback 2026-08-24 (post-E2b screenshots, mid-visual-pass):**
1. "grouping works" — incl. the constancy showcase: facet cols=crcl + color=crcl
   + group=sex renders two sex curves per panel, BOTH wearing the panel's crcl
   level color (degenerate facet+color, per group); readout labels compose
   "1200 mg · ≤ 105.5 · 1". Working as designed.
2. **Desync persists in GUIDED ("simple") mode** — the scrollbar-gutter fix
   covers Advanced but the user still sees desync in Guided. Investigate the
   guided path separately: likely the in-cell readout (.dist-inline .readout)
   growing after a click changes the dist CHART height post-paint, or a
   different scroll container. Reproduce headlessly (guided, Show readout on,
   click box, compare scatter vs dist x-axis pixel positions).
3. **E3 P1 confirmed wanted**: with endpoint COLUMNS the user tried to mirror
   the boxplot per endpoint column — "not possible" today (Slice D collapsed
   strips to one pooled grid). Per-column strips under endpoint columns is the
   E3 P1 work item.
4. **E5 linetype channel requested** ("can we set the linetype channel") —
   user-mappable linetype (endpoints | variable), already planned as E5.

**E2b (landed a717e57) targeted these user-confirmed bugs:** (1) axis desync fires ONLY when Overlays →
"Show readout" is checked (readout strip height change mid-paint — re-measure/
repaint after readout render); (2) facet-ROWS-by-variable overlaps the mirrored
dist panels (user screenshot 2026-08-24: three dist blocks collide) — add a
snapshot scenario, then fix; (3) then converged painter (delete
paintCompareScatterIntoWrap, one styleFor(group), user-owned response scale).
Also logged: "recode value as missing" data-prep mapping (race=99) — future
Data-panel feature, NOT grammar.

**Older context below (2026-08-16 era; superseded where it conflicts):**  
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
**QA ROUND 13 (`d343f4c`):** missing-as-zero bin poisoning FIXED (Number(null)=0 dragged every cut toward 0; crcl median 92.5→105.5, caught by user R cross-check); bin labels now carry cut values ("crcl: ≤ 105.5"); cut population RULE: analysis base cohort (external/protocol breaks = future explicit input); snapshot harness facet tokens fixed (var: prefix — s4 baseline had silently captured the wrong layout) + unknown-token guard; baselines re-captured, s4 Ns now match user R exactly. **NEXT SLICE before E2: explicit "(missing)" level** (facets/strips/color, gray, ordered last) + one-click exclude-missing in Filters (user rulings, rethink §K). Then E2.

**GROUPING MODEL ADOPTED (2026-08-21, rethink §J):** explicit `grouping` spec field replaces fitByColor (constancy theorem: a curve wears a channel iff the channel variable is constant in its group); strips stay channel-driven (provisional); callout density default = SELECTED-ONLY. E-sequence: ✅ E1 (`4ff981c`) pipeline extracted to analysis/selectionProjection.ts + UNIT conformance matrix (demo vitest, 5 tests, real adapters, fake cohort) — F4 now complete at BOTH levels. Next: E2 = grouping model + converged painter (one styleFor(group) painter, user-owned response scale, implicit facet for unscaled linear in shared cells); then E3 strips P1/P2, E4 presets+dead code (incl. deprecated alias cleanup), E5 linetype, E6 callout control.

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
