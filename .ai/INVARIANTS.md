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

## I8 — Projection granularity = declared grouping (QA round 11; restated §J, E2)

**Rule:** a projection resolves to groups at the panel's CURVE granularity, and
curve granularity IS the declared `grouping` (§J). Each selected strip row's
rows are PARTITIONED by the grouping — one projected group per curve group
present, associated with its curve STRUCTURALLY via `curveKey` (never by parsing
group-id strings). No grouping → one pooled partition on the pooled curve. A
pooled window NEVER rides a group curve. Projection color follows the constancy
theorem (one law with curves): channel encoding iff the channel variable is
constant within the projection's rows; neutral otherwise. The READOUT mirrors
the same granularity — one exposure+fit line pair per partition, fit values from
that partition's own fit cohort (never a pooled fit under split curves).

**Bug history:** pooled-window-on-every-curve existed for binary only (I7
violation — BRLS showed nothing on the orange curve); "first curve" hosting
flipped per panel; the continuous dose-branch mapping fell through to
`resolveDoseColor` under split strips — the thrice-recurring "magenta
vestigial"; the pre-E2 readout printed a POOLED fit line under split curves —
values from a curve that was never drawn.

**Guard:** `partitionSelectionByGrouping` (the only partition point) inside
`projectedSelectionGroups`; `curveKey` association in both renderers
(`projectedForCurveKey`, `samplesForGroup` curveKey match); unit conformance
matrix scenario "grouped curves + pooled dose click". **Prevention:** any new
projection source that maps `selectedDoses` directly to colors/stats without
`rowsForDistGroupId` + the partition step is a violation; any curve↔projection
association by id-string parsing (rather than `curveKey`/`groupKey`) is a
violation.

## I9 — Missing is an explicit level (QA rounds 12–13)

**Rule:** every categorical/binned variable whose cohort contains missingness has
a first-class "(missing)" level — facet panel, strip sub-row, color level, curve
group — reserved gray ink (never a palette slot), ordered LAST. Cut points are
computed on non-missing values of the analysis base cohort only; bin labels carry
the cut values ("crcl: ≤ 105.5"). One-click `missing`/`notMissing` filter
operators exclude/inspect missingness explicitly.

**Bug history:** Number(null)=0 poisoned every cut toward zero (crcl 92.5 vs true
105.5); 176/704 patients silently vanished from crcl facets; opaque "≤ median"
labels made cuts unverifiable — all caught by the user's external R cross-check.

**Guard:** `variableBins.test.ts` (missing never in cuts; explicit level ordered
last; value-bearing labels); snapshot s4 carries the (missing) panels with Ns
matching the user's R NA rows (56/67/53).

## I10 — Grouping is explicit statistics; channels are paint (§J, E2)

**Rule:** the spec's `grouping: { variableIds }` is the ONE authority on fit
units: curves/fits exist per endpoint × declared group (any variable or dose,
under any channel; empty = pooled). Channels (color, later linetype) partition
MARKS only — points, strip sub-rows, observed markers — never fits. What a
curve wears is derived, never chosen: the CONSTANCY THEOREM (a curve carries a
channel's encoding iff the channel variable is constant within its group's
rows; else neutral ink) — this one law yields the neutral pooled curve with
colored points, the degenerate facet+color level-colored curve (variables AND
dose), and endpoint-colored group curves under color=endpoints. `fitByColor` is
DELETED from every consumer; `resolveGrouping` migrates persisted legacy specs
at the resolve boundary.

**Bug history:** "fit separately per color group" entangled statistics with
paint — grouping was impossible without a visual channel, dose needed a special
branch, endpoints color silently stripped the flag, and adding linetype would
have forced a third flag.

**Guard:** `cellContext.test.ts` (grouping partitions, constancy incl. the
mixed-group-neutral case, legacy migration); unit conformance matrix (grouping
scenarios per family); domain type has no required `fitByColor`. **Prevention:**
any code that decides fit cohorts from `spec.color` (rather than
`resolveGrouping`) — or paints a curve without a constancy check — is a
violation.

**Linetype (E5):** `linetype` is a SECOND paint channel for curve strokes only
(none | endpoints | variable), governed by the SAME constancy law — a curve
dashes iff the linetype variable is constant within its group. Absent =
endpoints (the legacy dash-by-endpoint rule: multi-endpoint cells and the
endpoints color channel; single-endpoint cells solid). Points, strip shapes,
and observed markers never dash. The one-COLOR-channel rule (I2) is untouched —
linetype exists precisely so a second variable never needs a second palette.
Guard: snapshot s8 (facet+color=crcl degenerate + group=sex + linetype=sex —
two same-colored curves per panel distinguished solid vs "8 5").

## I11 — Unified minimum support: statistics abstain, data stays (2026-09-01)

**Rule:** every displayed statistic declares its minimum support; below it, the
statistic ABSTAINS and the raw data stays on screen. ONE threshold pair in ONE
place — `MIN_SUMMARY_N = 5` / `MIN_FIT_N = 5` (`analysis/support.ts`) — and one
tier function `supportTierFor(n)`: "full" (n ≥ 5), "minimal" (2–4), "single" (1).
Enforcement lives at the CENTRAL stat seams, never per painter:
- `summarizeDistribution` returns a tiered summary; below "full", q1/q3 and the
  whiskers are **NaN** (the abstention encoding), min/median/max/mean stay honest.
- Dist shape builder (`computeDistributionGroupData`): below "full" it emits
  `rawPoints` — the row renders its raw values as points, no box/violin/
  lineranges at any mode.
- Selection pipeline: projections carry the tiered summary; geometry layers
  (`DoseProjectionLayer`) skip non-finite markers, so an abstaining group shows
  range band + median tick, never a fabricated Q1–Q3 core.
- `tryFitForCohort` is the ONE fit gate for every family and every curve path
  (pooled + grouped, all painters): below MIN_FIT_N no curve exists; the P1
  degenerate point marker still covers single-distinct-x cohorts that fit.
- Readout prints only the tier's statistics (Min·Median·Max at minimal, the
  value at single) and says `— fit n/a (N=k)` when the fit abstained.
Observed x/N and mean±CI markers are DATA, not estimates — unchanged at any n
(meanConfidenceInterval already degenerates honestly at n=1).

**Why NaN:** a consumer that forgets to check the tier draws NOTHING rather
than a fabricated quantile — abstention propagates through every pipeline
without per-painter policy.

**Bug class prevented:** a boxplot/25th-percentile/fitted curve fabricated from
2–4 points reads as evidence ("the readout should not show a 25% percentile
when we have 3 points" — user ruling 2026-08-31).

**Guard:** `analysis/support.test.ts` (tier boundaries, NaN abstention);
renderer tests (rawPoints row, NaN-quartile projection); snapshot s13 (recoded
race tiny cells: raw-point strip rows, tiered readout, fit n/a, zero "NaN" in
any baseline). **Prevention:** any new statistic must route its support
decision through `supportTierFor` at its producing seam; any literal `< 3`/`< 5`
support check outside `analysis/support.ts` is a violation.

## I10 addendum — dash has ONE authority; the renderer has NO styling policy (2026-09-02)

**Bug:** `FitLayer` carried a legacy default (`dash: undefined` → `"7 5"`). The
binary painter passed the linetype module's `""` ("solid") through verbatim;
the continuous painter coerced it (`c.dash || undefined`) into the default —
so the SAME spec drew sex=1 solid on a binary panel and dashed on a continuous
panel (user report 2026-09-02, probe-confirmed). "Solid" and "no opinion" had
been conflated in one empty string.

**Rule:** `linetypeAccessFor` is the ONE dash authority; every curve painter
passes its output verbatim; `FitLayer` draws a dash ONLY when the caller states
a non-empty pattern (`""`/`null`/omitted = solid — no renderer default). The
classic dashed gray pooled curve is gone by user veto: pooled curves are solid
in every family. **Guard:** renderer FitLayer tests (solid default, verbatim
""), snapshot s14 (same spec, binary + continuous panels: sex 1 solid / sex 2
"8 5" identically). **Prevention:** any layer default that encodes a visual
CHANNEL (dash, color) rather than geometry is a violation — encoding decisions
live with the channel authorities in the demo/domain, never in the renderer.

## I8 addendum — no ride, no render; no fallback association (2026-09-03)

**Bug:** the continuous painter's `samplesForGroup` kept a legacy fallback
chain (suffix/dose/level match → FIRST CURVE) for "producers without curveKey".
Every producer now routes through the one pipeline, which ALWAYS sets curveKey
— so the fallback's only reachable effect was an I8 violation: a clicked group
whose fit ABSTAINED (below MIN_FIT_N) drew its projection markers and observed
pill on a FOREIGN group's curve, on continuous panels only (binary attaches
projections per curve and never saw orphans). Probe-caught during the
small-groups test protocol.

**Rule:** a projection renders IFF its curveKey structurally matches a curve
("" = pooled). An orphaned projection renders NOTHING on the scatter — the
group's raw points still highlight and the readout still reports
Min·Median·Max + "fit n/a (N=k)". One filter (`ridableProjected`) gates every
projection artifact: bands, range/core lines, markers, observed pill, fit-
callout host keys. The dead `level` plumbing on curve overlays was deleted
with the fallback.

**Guard:** snapshot s13 clicks two uncurved groups (race 1 N=4, race 8 N=1)
on binary AND continuous panels — zero projection geometry on both, readouts
unchanged. **Prevention:** any association by string parsing or positional
fallback (first curve, level match) instead of the structural curveKey is a
violation.

## Linetype law B — unmapped paints nothing; mapped applies unconditionally (2026-09-17)

**User ruling ("B — no gating, no special cases"):** the linetype channel obeys
one law with zero gates. `resolveLinetype` absent = **none** (an unmapped
channel paints nothing — all curves solid). Mapped `endpoints` = an IDENTITY
scale: each endpoint wears its dash everywhere it appears — alone, faceted, or
overlaid — exactly as it wears its identity color; the old
`cellEndpointCount > 1 || color.kind === "endpoints"` gates are DELETED.
Mapped `variable` = positional scale trained on the filtered base cohort, by
constancy — deliberately the same training rule as variable color (a level
filtered down to be alone takes position 0 = solid, just as it takes the first
palette color; endpoint scales are identity, variable scales are trained — the
same split in BOTH channels is symmetry, not exception). Presets WRITE channel
mappings: the Overlay guided preset sets `linetype: endpoints` in its spec, so
its dash-by-endpoint look is an explicit mapping, not a rule default.

**Guard:** domain resolveLinetype tests (absent = none, mappings pass through);
snapshots — s1–s3 byte-identical (preset-written mapping), s4 gate-dash removed
(unmapped = solid), s12/s13 brls identity dash "4 3" on group curves in faceted
single-endpoint cells (mapped = unconditional), s8/s14 variable linetype
untouched. **Prevention:** any condition on a channel's application other than
the mapping itself + constancy is a violation.

## Endpoint accent on strips/projections — constancy over the mark's scope (2026-09-17)

**User-confirmed bug:** per-COLUMN strips under color=Endpoints rendered
neutral. **Rule (the SAME constancy law as a single-level variable cell):**
under the endpoints channel, dist rows and dose-click projection accents wear
an endpoint's accent iff the endpoint is constant over the MARK'S OWN SCOPE —
a scatter cell is its own scope; a dist strip's scope is every endpoint it
serves (`readoutEndpointIds`, the enumeration truth). So: per-column strip →
its endpoint's ink; collapsed rows-strip (serves several endpoints) → neutral;
multi-endpoint overlay cell rows → neutral; projections in single-endpoint
cells → that endpoint's accent (both painters — the binary color=endpoints
branch had skipped resolveDoseRowPaint; threading it restored I7 symmetry).
Policy lives in domain (`DistRowPolicy.palette: "endpoint"` + endpointId in
resolveCellContext); demo supplies the strip scope to resolveDoseRowPaint.

**Guard:** cellContext test (single-endpoint cell → palette "endpoint";
overlay cell → neutral); snapshots s15 (per-column strips + matching
projection accents, binary AND continuous identical) and s16 (collapsed
rows-strip neutral while its cells' projections wear their own accents).
**Prevention:** any strip/projection paint decision that bypasses
resolveCellContext/resolveDoseRowPaint, or evaluates constancy over a proxy
scope (first cell instead of the strip), is a violation.

## ADR-0013 fourth family: Emax/Hill (2026-09-18)

**Scope decision (user ruling):** Emax is CONTINUOUS-ENDPOINTS-ONLY. Binary
Emax was designed (reparametrized bounded-MLE on the probability scale, to
avoid both a weak logit-scale variant and clamping) but explicitly parked:
"a nonlinear Emax funciton inside a nonlinear logit becomes quickly very hard
to have enough data for." The proper long-term binary smoother is a GAM-based
replacement for the current unconstrained binary loess (deferred design note,
project memory) — not a bounded Emax bolt-on. The Endpoint Models UI omits
"Emax" from the option list for binary endpoints; `fitForCohort`'s emax
branch additionally guards `isContinuousEndpoint(endpoint)` defensively (a
stale session's "emax" on a now-binary endpoint falls through to logistic).

**Fitting is deterministic — no starting values, ever.** For fixed (EC50, γ)
the model E = E0 + Emax·x^γ/(EC50^γ+x^γ) is exactly linear in (E0, Emax) via
u(x) = x^γ/(EC50^γ+x^γ); the only nonlinear search (over EC50, and γ when
estimated) is an exhaustive log-spaced grid — which can't miss a far-off
optimum — followed by golden-section refinement — which needs only a bracket,
never a guess. This directly targets the failure mode of naive Emax fitting
(local-optimizer initial-value sensitivity; user's own ggquickeda Emax "prone
to not working depending on initials"). `packages/model-emax` is dependency-
free and self-guards (`EMAX_MIN_N=5`, `EMAX_MIN_DISTINCT_POSITIVE_X=3` — EC50
is not identifiable below 3 distinct doses even with N≥5), matching the
model-loess precedent.

**Two independent, symmetric per-endpoint toggles** (persisted, session-
round-tripped): estimate γ (default OFF, fixed=1 — plain Emax) and estimate
E0 (default ON; OFF fixes E0 at exactly 0 for the "no placebo/SoC anchor"
case — the curve is forced through the origin). No separate inhibitory flag:
the SIGN of Emax alone decides stimulatory vs. inhibitory, symmetric with
every other family (nothing else in the app has a stimulatory/inhibitory
switch either).

**CI = delta-method (Gauss-Newton) SE × t**, same shape as loess's H4b band
(numeric Jacobian of the mean function w.r.t. active parameters at the
optimum → Cov(θ) ≈ σ²·(JᵗJ)⁻¹ → variance of a prediction via g^T·Cov·g).
Bootstrap is future work — like loess, both CI settings currently draw the
same band; documented in the UI hint, not hidden.

**Universal equation/parameter display (`describeFit`, new leaf function in
main.ts, switches on `EndpointFit.kind`):** every family — logistic, linear,
loess, emax — describes itself; shown via (a) a `title` tooltip on the
readout's `.readout-line-fit` line (per-fit, so a shared strip's icgi line
and brls line each show THEIR OWN family's equation) and (b) a live preview
line under each endpoint's model select in the Endpoint Models UI (recomputed
on every settings change, loess's span/degree included — the toggle-refresh
treatment applies identically to every family, not just Emax). This is a
DISPLAY concern, not a pipeline seam — ADR-0013's "adapter only" contract is
about the selection/projection/readout/painter machinery, which `describeFit`
does not touch; a family that skipped it would just show no equation.

**Verification:** model-emax's own test suite (14 tests) is the primary
correctness property — mirroring model-loess's "exact polynomial
reproduction" pattern — exact E0/Emax/EC50/γ recovery on NOISELESS data with
NO starting values supplied anywhere, for plain Emax, γ-estimated (sigmoid),
E0-fixed-at-0, and negative-Emax (inhibitory) cases; plus determinism,
abstention guards, CI shape, and the describe contract. Snapshot s17 pins the
fourth-family proof itself: brls (γ estimated) + prls (E0 off) under the
SAME grouping/linetype/click pipeline as every other family — s1–s16 stayed
byte-identical across the whole slice, meaning Emax required zero changes to
any existing pipeline, only a new adapter (the ADR-0013 promise, proven a
second time after loess).

**Also fixed in this slice (latent gap, unrelated to Emax specifically):**
`verify-build.mjs`'s package list never included `model-loess` (or now
`model-emax`) — it only "worked" because a stale `dist/` from an earlier
manual build persisted locally; a fresh checkout would have failed
`tsc apps/demo` on either import. Both are now in the list.

## Emax addendum: boundary-pinned parameters are flagged, never hidden (2026-09-19)

**Motivating find:** the user's real BRLS data has essentially no Emax-shaped
signal against AUC (independently confirmed: our fit, R's `nls()` — singular
gradient — and R's `minpack.lm::nlsLM()` — converged to a nonsensical negative
EC50 = −14, RSS 52168, WORSE than a flat-line null model at RSS 17455 — all
agree). Our own fit tied the null model (RSS 17448) with EC50 pinned to
`xMinPos/50`, EXACTLY the grid's lower edge — proving the local-optimum trap
`nlsLM` fell into is a real failure class this design avoids, but also
surfacing a gap: a boundary-pinned parameter was silently presented as an
ordinary point estimate.

**Rule:** the golden-section refine only ever narrows within the neighborhood
of the coarse grid's best index — it can never search past `ec50Grid[0]`/
`[last]` or `gammaGrid[0]`/`[last]`. A best index sitting AT either edge is
therefore a reliable, cheap-to-compute signature that the unconstrained
optimum wants to go further and the search grid stopped it there (a flat or
edge-monotone RSS surface) — not a numerical accident. `EmaxFit` carries
`ec50Boundary`/`gammaBoundary: "lower" | "upper" | null`; `describeEmaxFit`
turns a non-null flag into a `warning` string. `describeFit`'s shared return
shape gained an optional `warning?: string` slot (universal across all four
families, even though only Emax populates it today — same "shared contract,
per-family population" pattern as the rest of `describeFit`), surfaced via
both existing display sites: the readout-line tooltip and the Endpoint Models
preview line (new `.endpoint-model-warning` block).

**Guard:** model-emax tests pin all three cases — a step-only (placebo-vs-
dosed) pathology pins EC50 low with a warning; a well-identified interior fit
reports no flags/no warning; a step-sharp curve pins γ high independently of
EC50. Neither display surface (tooltip `title`, Endpoint Models panel) is
part of the visual-snapshot `capture()` shape, so all 17 baselines stayed
byte-identical — verified, not assumed.

## Bundled dataset: ICGIEMAX synthetic showcase endpoint (2026-09-19)

A new continuous endpoint, `icgiemax`, baked into `apps/demo/data/icgi.csv`
(and only there — `effICGI.csv` is a dormant, unused fallback, left
untouched) — deterministic (seeded, reproducible), keyed to each row's REAL
AUC value: E0=10, Emax=25, EC50=90, **γ=1.4** (deliberately non-1, so the
"estimate γ" toggle has something genuine to recover), noise SD=3. With γ
fixed (the default), the misspecified model compensates with an inflated
Emax/EC50; toggling γ estimation recovers all four true parameters within
noise — a deliberately instructive default/toggle contrast, not just a clean
recovery demo.

Wiring required (all data-driven, zero per-name special cases): the CSV
column, `build-data.mjs`'s record mapping + interface field,
`datasetContext.ts`'s `bundledRowsFromRecords` field pass-through, and
`columnMapping.ts`'s `EFFICGI_DEFAULT_ROLES` entry (the bundled-reload path
defaults an ABSENT column to role "ignore", so this entry is required even
though the generic `guessColumnRole` heuristic would already classify
"icgiemax" as an endpoint via its "icgi" prefix — that heuristic only applies
to a freshly-uploaded CSV, not the bundled-reload shortcut). Endpoint color/
dash/label all fall back to the existing generic palette/uppercase-id
mechanisms with no new per-name entries — same precedent `icgi7` already
established. The endpoint defaults to Linear (the generic continuous
default), not to Emax — no per-column model-name special case either; the
user picks Emax from Endpoint Models like any other endpoint.

All 17 existing snapshots stayed byte-identical after adding the endpoint —
confirms an available-but-unselected endpoint is fully inert to every
existing default view.
