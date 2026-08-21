# Invariants — bug classes, the rule that kills each, and its guard

**Date:** 2026-08-17. Distilled from the encoding-v2 QA campaign (10 rounds of
user QA, ~15 root-caused bugs). Every future change is checked against these.
An invariant is not advice: violating one is a bug even if the pixels look fine.

## I1 — One bin model per view (base cohort)

**Rule:** every binned covariate (median/tertile/quartile) has exactly ONE cut-point
model per view, computed on the base cohort (all filtered rows). Cut points never
shift per facet, per panel, per strip, or per selection. Level membership is
evaluated per subset; the cuts themselves never are.

**Bug history (violated FOUR times, each in a different subsystem):**
`buildDistributionGroups` (strip rows), `paintRegularScatterIntoWrap` (scatter
color model), `expandDimension` (facet enumeration — orange points inside a
"≤ median" panel), `projectedGroupsForDistSelection` (selection projections —
clicked N=6 row projecting as 8/9).

**Guard:** all four sites now call `buildColorBinModel(loaded, var, dataFilteredRowIndices()/baseIndices, …)`.
Data test: `viewLayoutEnumerate.test.ts` "nested binned facet uses BASE-cohort cut
points". **Prevention:** any new call that passes a panel/branch/selection cohort
as the bin base is wrong by definition — grep for `buildColorBinModel(` /
`buildVariableLevelModel(` in review; long-term, expose ONE memoized
`colorModelForView()` and delete the per-site constructions.

## I2 — One categorical color channel per view

**Rule:** the `color` mapping has exactly one meaning on screen. Elements grouped
by the color variable wear the palette; everything else is neutral ink. Selection
highlight is a state accent, not a channel.

**Bug history:** dose rainbow under color=wt strips; endpoint-accent strips;
violet dose projections under color=sex; dose-colored readout labels.

**Guard:** `resolveCellContext().distRows` + `resolveDoseRowPaint` +
`colorForDistGroupId` are the only palette deciders for dose-grouped elements.
Smoke #2 (neutral strip), #6 (monochrome points). **Prevention:** a paint path
calling `resolveDoseColor`/`endpointColor`/`variableColorForLevel` directly for a
dose-grouped element, instead of through those resolvers, is a violation.

## I3 — Cohort contract (ADR-0011/0012)

**Rule:** every statistic a panel displays is computed from
`(clicked group rows) ∩ (panel facet cohort)`, endpoint-finite where the statistic
belongs to an endpoint. No paint path reads global rows. The single exception:
reference-split CUT POSITIONS (per exposure metric, placebo/SoC excluded,
endpoint-missingness-independent).

**Bug history:** identical callouts across facet panels; compare cells projecting
global 34/37 in every sex panel; readout Ns from global dose rows; continuous
projection stats ignoring facet.

**Guard:** `rowsForDistGroupId(gid, active, cohort, endpoint, colorCtx)` is the
one row resolver; projections and readout both consume it. **Prevention:** any new
overlay/stat that calls `recordsWithEndpoint`/`rowIndicesForDose` without
intersecting the panel cohort is a violation; the smoke matrix should assert
"two facet panels never show identical callout strings when cohorts differ"
(queued, Slice E).

## I4 — Projection–curve association

**Rule:** a clicked group renders (band, core, markers, callout) on exactly ONE
curve: the curve of its own group (matching level/endpoint). Never duplicated per
curve, never on the first curve by accident.

**Bug history:** duplicate callouts (full projected array attached to every level
curve); blue group's band riding the orange curve; continuous projections always
using the first curve's samples.

**Guard:** binary `projectedForCurve(level, isFirst)`; continuous curve overlays
carry `level` + `samplesForGroup(gid)`. **Prevention:** any renderer overlay list
built per curve must be filtered by group↔curve identity, not copied.

## I5 — Scale-bearing facets are mandatory and implicit facets are derived

**Rule:** >1 exposure metric (or >1 endpoint outside a color=endpoints overlay)
must be faceted; if the user placed no facet, the system adds an `implicit` one.
Implicit dims are stripped and recomputed on every resolution, invisible to the
layout UI, and outranked by any authored dimension.

**Bug history:** AUC silently dropped; metrics-as-rows duplicating the first
metric; implicit column blocking metrics-on-rows (sticky derived state).

**Guard:** `ensureScaleBearingFacets` + `dedupeFacetDimensions` (explicit beats
implicit) + `applyFacetSelectFromSpec` skipping implicit; domain tests. Data
tests for both fallback-clobber directions. **Prevention:** the synthetic
no-columns enumeration branch contributes NOTHING to facet keys — keep it that way.

## I6 — Selection references only rendered groups

**Rule:** a selection may only reference dist rows that exist in the current
layout; orphans are pruned after each paint pass. The serialized form is the
domain `ViewSelection`.

**Bug history:** stuck boxplots with no way to unselect; ghost projections from
stale `dose|level` ids after channel changes.

**Guard:** `registerRenderedDistGroups` + `pruneOrphanedSelection`; session
round-trip via `ViewSelection`.

## I7 — MODEL-FAMILY SYMMETRY (the standing order)

**Rule:** every selection/overlay/readout feature exists ONCE, parameterized by
the endpoint's model family — never re-implemented per family. Adding a family
(Emax, ordinal, bounded smoother) must require implementing an adapter interface
ONLY, with zero changes to projections, readout, callouts, strips, or selection.

**Bug history — the most expensive class of this campaign:** fit-per-color existed
for logistic but not linear (BRLS pooled gray curve); split-row projections
existed for binary but not continuous (orange/magenta dose bands); binary stats
kept endpoint-missing rows while linear filtered them; per-curve fitted markers
existed on one path and not the other. Each was found by a HUMAN comparing two
families by eye — that does not scale to N families.

**Target (ADR-0013):** one `EndpointFamilyAdapter` per family —
`fit(rows) → model`, `curve(model, xDomain) → samples+CI`, `fittedAt(x)`,
`observedSummary(rows) → {label, center, lower, upper, n}` (x/N Wilson for
binary, mean±CI for continuous, P(Y≥k) set for ordinal), `readoutFormat`.
The pipelines (curve groups, projections, readout, callouts) consume adapters and
are written once. **Conformance test:** one parameterized suite that runs the SAME
scenario (facet × color × split × click) against every registered family and
asserts the same structural outputs (group count, cohort Ns, per-curve
association, color keys) — so "does linear behave like logistic" is a CI matrix,
not a manual QA question.

---

Related: [`ENCODING_V2_RETHINK.md`](./ENCODING_V2_RETHINK.md) (design record),
`docs/DECISIONS.md` ADR-0012 (grammar) and ADR-0013 (family adapters),
[`CONTINUE_HERE.md`](./CONTINUE_HERE.md) (slice progress).

## I8 — Projection granularity rule (QA round 11, "once and for all")

**Rule:** a projection resolves to groups at the panel's CURVE granularity.
Split curves (fit-per-level / fit-per-arm) → a pooled dose selection expands to
`dose×level` (or per-arm) groups, each on its own curve with its own color and
stats. Pooled curve → pooled group. A pooled window NEVER rides a split curve,
and no projection color is ever decided outside `colorForDistGroupId`.

**Bug history:** pooled-window-on-every-curve existed for binary only (I7
violation — BRLS showed nothing on the orange curve); "first curve" hosting
flipped per panel; the continuous dose-branch mapping fell through to
`resolveDoseColor` under split strips — the thrice-recurring "magenta vestigial".

**Guard:** `projectionGidsAtCurveGranularity` (the only expansion point) inside
the two dist-selection functions; strict level↔curve association in both
renderers (`projectedForCurve(level)`, `samplesForGroup` level/dose match); the
dose-branch fallback mappings are DELETED — every selection routes through the
one dist-selection pipeline. **Prevention:** any new projection source that maps
`selectedDoses` directly to colors/stats without `rowsForDistGroupId` +
`colorForDistGroupId` is a violation.
