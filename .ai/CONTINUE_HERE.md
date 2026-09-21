# Continue here (session handoff)

## ⭐ PROJECT STATE — READ THIS FIRST (checkpoint 2026-09-20)

Everything below this section is the full historical log, kept for
archaeology. This block is the complete, current, self-contained picture —
read it, then only dip into the log below for the "why" behind a specific
decision.

### Verified-clean checkpoint (this exact commit, re-run just now)

Full fresh-checkout simulation — every `dist/` and `*.tsbuildinfo` wiped,
gitignored `apps/demo/src/data.generated.ts` regenerated from scratch,
built in dependency order:

| check | result |
|---|---|
| `node apps/demo/scripts/verify-build.mjs` | OK (8 packages + demo, clean) |
| Unit tests, all 9 packages | **271 passed**, 0 failed (domain 49, analysis 14, model-linear 20, model-loess 9, model-emax 17, data 62, renderer 76, session-engine 17, demo 7) |
| `pnpm --filter @er-explorer/demo smoke:ui` | ALL CHECKS PASSED (7 scenario groups incl. the I7 conformance matrix) |
| `node apps/demo/scripts/visual-snapshot.mjs` | **ALL 17 MATCH** (s1–s17, byte-identical) |

Working tree: clean except the always-untracked-in-spirit
`claudetwoexposureoneendpoint.R` (tracked by git but NEVER staged — see git
hygiene note below). Last commit: `19f5741`.

**No known open bugs.** The confirmed-bug queue that existed at various
points this multi-day session (linetype dash asymmetry, orphan projections,
shared-strip readout, per-column strip endpoint color, the E3 rows-facet
color-split block, the CRCL provenance mismatch) is fully closed — see the
dated log entries below for each, and `.ai/INVARIANTS.md` for the permanent
rules each one left behind.

### Architecture map (packages)

| package | role |
|---|---|
| `packages/domain` | Pure grammar/policy: `ViewLayoutSpec`, grouping (§J), linetype/color channels, `resolveCellContext`/`resolvePanelVisualPolicy` (the two parallel "what does this cell/strip look like" resolvers — see the E3 fix note below on why there are two and how they relate), invariant-bearing predicates (`endpointStripsAreDistinct`, `layoutHasEndpointFacet`, etc.) |
| `packages/data` | `LoadedDataset`, column type inference, level/bin models (incl. the `(missing)` level, I9, and the recode registry), `enumerateScatterPanels`/`enumerateDistPanels` (facet grid + dist-strip collapse) |
| `packages/analysis` | Family-agnostic selection→projection pipeline (`selectionProjection.ts`), `summarizeDistribution` (the tiered I11 five-number summary), legacy logistic/bootstrap stats |
| `packages/model-linear` | OLS linear family: fit, Wald/bootstrap CI, mean-CI |
| `packages/model-loess` | LOESS family: R `stats::loess`-matching local regression (gaussian, tricube), **currently legal-but-unconstrained on binary data — this is the next redesign, see below** |
| `packages/model-emax` | Emax/Hill family: deterministic grid+golden-section fit (NO starting values ever), continuous-endpoints-only, boundary-pinned-parameter diagnostic |
| `packages/renderer` | Pure SVG painting: `DistributionLayer`, `DoseProjectionLayer`, `FitLayer` (no dash/color policy of its own — obeys the caller verbatim), `ConfidenceRibbonLayer`, etc. |
| `packages/session-engine` | `.erx` session serialize/parse |
| `apps/demo` | The actual app: `main.ts` (~5.9k lines — paint, selection, endpoint models UI, readout), `index.html` (all UI + CSS), `data/icgi.csv` (bundled dataset, now with `ICGIEMAX`), `scripts/visual-snapshot.mjs` (s1–s17 byte-exact regression harness), `scripts/ui-smoke.mjs` |

### The bundled dataset today

`apps/demo/data/icgi.csv` — 704 rows, columns: `STUDY, ID, DOSE, GBDS, SEX,
AGE, WT, RACE, CRCL, BRLS, PRLS, AUC, CMAX, ICGI, ICGI7, ICGI2, ICGI3,
ICGIEMAX`. CRCL is 25% missing (176 rows) — confirmed matching the user's own
R-side count. Endpoints: `icgi`/`icgi2`/`icgi3` (binary), `icgi7` (ordinal,
treated as binary-ish today), `brls`/`prls` (continuous, real, genuinely
near-flat vs. AUC — see the R cross-check note below), `icgiemax`
(continuous, **synthetic**, deterministic/seeded, keyed to real AUC: E0=10,
Emax=25, EC50=90, γ=1.4 — a well-identified showcase for the Emax family;
defaults to Linear like any continuous endpoint, pick Emax from Endpoint
Models yourself).

### Full invariant list (see `.ai/INVARIANTS.md` for the complete prose + bug history of each)

I1 one level model · I2 one color channel · I3 cohort = clicked ∩ panel ∩
endpoint-finite · I4 curve association is structural (curveKey), never
string-parsed · I5–I7 (family/adapter symmetry, ADR-0013) · I8 projection
granularity = declared grouping, restated for §J · I9 explicit `(missing)`
level, gray, ordered last · I10 grouping is statistics, channels are paint
(constancy theorem) + linetype addendum + **dash-authority addendum**
(FitLayer has no policy of its own) + **endpoint-accent-by-scope addendum**
(strips/projections wear an endpoint's color iff constant over the MARK'S
OWN scope, not the whole spec) · I11 unified minimum-support rule (N≥5 full
five-number/box/fit, 2–4 → raw points + Min·Median·Max, 1 → single value;
abstention is NaN, never fabricated) + **boundary-pinned-parameter addendum**
(Emax: a search hitting its grid's edge is flagged, not presented as an
ordinary estimate) · **E3 addendum** (`endpointStripsAreDistinct` — endpoint
color-split is legal whenever a strip spans >1 endpoint, i.e. rows-faceted
or unfaceted; illegal only on columns, where each strip already has exactly
one) · **I8-adjacent** (orphan projections: no curve to ride ⇒ no render,
ever — no fallback association).

### Condensed slice history (chronological, full detail in the log below)

**Grammar era (I1–I9, missing-level, level recoding, PK/non-PK, reference
arms):** `fca1de7` → `b32b480`. **§J grouping model + E-sequence
(E1–E6: grouping, painter convergence, per-column strips, guided presets,
linetype, callout density):** `761d3b5` → `9936341`, polish `97747b2`.
**Data-prep (level recode, reference arms, vestigial sweep):** `8a762c4`,
`b32b480`, `6960e46`. **LOESS (3rd family):** `990d0ac`. **Unified
minimum-support (I11):** `1814419`. **Dash authority, shared-strip readout,
orphan projections, linetype law B, endpoint-accent-by-scope (4 bug-hunt
slices from one user test pass):** `ffe2218`→`7934a20`. **Emax (4th
family) + CI fix + ICGIEMAX synthetic endpoint:** `f9bf215`→`99a1e45`.
**Hover-cue polish, CRCL provenance closure, E3 re-challenge:**
`6d442a3`→`19f5741`.

### R cross-checks performed this session (all independently confirmed)

- **Loess** on real BRLS/AUC: `nls()` → singular gradient (fails);
  `minpack.lm::nlsLM()` → converges to nonsensical EC50=−14 at RSS 52168,
  *worse than a flat-line null* (RSS 17455); our grid+refine fit ties the
  null (RSS 17448) with EC50 honestly pinned to the search boundary — now
  flagged in the UI. Conclusion: BRLS genuinely has no dose-response signal
  vs. AUC on either side; R's local optimizer fell into exactly the local-
  optimum trap the deterministic design exists to avoid.
- **Emax** on simulated well-identified data (E0=20/Emax=15/EC50=80): all
  three parameters recovered within 1 SE, independently verified in R via
  `nls()`/`nlsLM()` (CSV sent to user).
- **ICGIEMAX**: independently fit in R three ways (ggplot2 loess-style
  smooth, ggquickeda, `nls()` split by WT bin) — all converged cleanly,
  confirming it's genuinely well-behaved, unlike BRLS.

### LANDED: binary loess → GAM replacement (engine + integration, 2026-09-21)

**The problem, documented with real numbers (2026-09-20):** the current
`model-loess` package fits a plain, unconstrained local regression on
binary (0/1) data — legal by design (round-2 §I.4, "never clamp"; the axis
pads instead of hiding the overshoot), but the *smoother itself* has no
mechanism to respect [0,1] the way a logistic/GAM approach would. Concrete
reproduction on the bundled `icgi`/`AUC` data:

| config | point-estimate range | 95% CI range |
|---|---|---|
| Full N=704, R-default span=0.75 | 0.43 – 0.90 (in bounds) | 0.12 – **1.33** (upper CI over 1) |
| sex=1 subgroup (N=282), span=0.5 | 0.29 – **1.07** (estimate itself over 1) | 0.13 – **1.89** |
| 600mg+1200mg subgroup (N=387), span=0.5 | 0.45 – 0.87 (in bounds) | **−0.11** – 1.16 (lower CI under 0) |

So at the R-default span the *point estimate* usually stays in range on
well-powered cohorts (the axis-padding rule mostly just needs to handle the
CI band), but on smaller/tighter-span subgroups — exactly the case the
grouping/faceting machinery makes routine — the point estimate itself
legitimately exits [0,1]. This is mathematically correct behavior for an
*unconstrained local regression*, but it's the wrong smoother shape for a
probability surface, which is why the user wants a GAM-based (or similarly
constrained, e.g. local-likelihood/binomial) replacement.

**DECISIONS CONFIRMED by user (2026-09-20) — logged, nothing built yet:**
1. **Family: penalized-spline GAM, mgcv-style — not local-likelihood.** User:
   "I am more familiar with mgcv::gam, the idea is that the effect of AUC
   might not be linear inside of the logit." Target shape:
   `logit(p) = β₀ + f(x)` where `f` is a smooth term (regression-spline basis
   + roughness penalty), the direct analog of
   `mgcv::gam(y ~ s(x), family = binomial, method = "REML")`. NOT a
   loess-style local-likelihood smoother — a genuine penalized-basis GAM.
2. **Fitting algorithm: delegated to Claude, not specified by the user.**
   User: "I don't really know what is a proper algorithm as long as we get
   statistically sound results consistent with R results. Speed and
   convergence are important." Hard constraints: (a) must match/cross-check
   against real `mgcv::gam` output on real data — "statistically sound,
   consistent with R" is the acceptance bar, not just internal self-
   consistency; (b) fast; (c) reliably convergent. The exact numerical
   approach (basis choice, penalized IRLS details, smoothing-parameter
   selection) is Claude's to propose and justify at design time — still
   "propose before code," just not a user-specified constraint.
3. **REPLACEMENT, not a coexisting option.** User: "no we need to replace
   the loess for binary as it can go beyond the limits and not really
   logical. it is a replacement." Binary endpoints' Endpoint Models select
   drops "Loess" entirely once this lands, replaced by the new GAM family.
   Continuous endpoints are UNAFFECTED — they keep Linear / Loess / Emax
   exactly as today (an unconstrained smoother is fine on a continuous
   scale; the [0,1] problem is binary-specific).
4. **Boundary-hit reporting: REQUIRED, confirmed.** User: "yes any time we
   hit a boundary we need to report it and warn/inform the user." Same
   pattern as Emax's `ec50Boundary`/`gammaBoundary` (I11 addendum) — if the
   new family's search (smoothing parameter, basis dimension k, whatever
   ends up being searched) hits its own boundary, `describeFit` must surface
   a warning, never silently present a poorly-identified fit as ordinary.
5. **No migration concern.** User: "we are still in the early stages, no
   sessions are expected to be restored on loess on binary — I am the only
   user so far and did not release anything yet in the wild." No
   backward-compat/session-migration work needed. A stale `"loess"` model
   choice loaded for a binary endpoint should simply fall through to the
   generic default (logistic) — the SAME defensive pattern already built for
   Emax-on-a-now-binary-endpoint (`fitForCohort`'s `isContinuousEndpoint`
   guard) — not a dedicated migration path.

**RESOLVED at build time (2026-09-20) — the previously-open questions:**
- **Package**: `packages/model-gam` (`@er-explorer/model-gam`), zero deps,
  same shape as `model-emax`/`model-loess`. `EndpointFit` kind will be `"gam"`.
- **Basis: cubic regression spline (`bs="cr"`), NOT mgcv's `bs="tp"` default.**
  Deliberate. `cr` is defined by a closed-form knot-value parameterization
  (Wood §5.3.1) that is reproducible exactly; `tp` requires an eigen-truncation
  of a thin-plate penalty and is far likelier to be subtly wrong in a
  reimplementation. Since "consistent with R" is the acceptance bar, the basis
  that can be checked exactly wins over the one that is merely default. The R
  cross-check call is therefore `s(x, bs="cr", k=…)`, not bare `s(x)`.
  Knot placement reproduces mgcv's `place.knots()` *exactly*, including its
  linear interpolation at fractional order-statistic indices (rounding to the
  nearest distinct x is defensible on its own but silently desynchronizes
  every R comparison — that was caught and fixed during the build).
- **Smoothing-parameter selection: REML**, matching `method="REML"`. Search is
  a 33-point log grid over a rescaled penalty then golden-section refinement —
  the same deterministic, no-starting-values shape as Emax, chosen for the
  same reason (no user-supplied initials that can silently pick a bad basin).
  `options.lambda` fixes λ manually; that is both a real user-override hook and
  what makes the "λ→∞ ⇒ straight logit line" test exact.
- **Boundary reporting**: `GamFit.lambdaBoundary: "lower" | "upper" | null`.
  `"upper"` is the informative one — it means the cohort supports NO curvature
  and the fit is just logistic regression. `describeGamFit` emits the warning.

**Engine status: BUILT AND GREEN.** 29 tests, ~250 ms, typecheck clean.
Coverage includes the exact algebraic properties (basis interpolates the knot
values to 1e-12; the penalty is exactly zero on any straight line; S is PSD of
rank k−2; linear extrapolation outside the knots), recovery of a genuinely
non-monotone logit, the λ→∞ ⇒ line collapse, determinism, every support guard,
and — the whole point — estimate AND CI strictly inside (0,1) on the same
pathological shape that made loess overshoot.

**Two real bugs found and fixed during the build (kept here because both are
easy to reintroduce):**
1. `ETA_CLAMP` was ±30, flooring the IRLS weights near 1e-13. On a completely
   separated cohort that put ~22 orders of magnitude inside one matrix and the
   Cholesky failed outright, so a fit that should have been reported as
   separated *vanished* instead. Now ±15 (p = 0.9999997 — nothing reportable is
   lost, and a separated fit has no finite MLE anyway). This is a conditioning
   control, not cosmetic clamping; do not "restore precision" by raising it.
2. Golden-section refinement could return a λ where PIRLS fails, and `fitGam`
   then returned null *despite already holding a valid grid optimum*. It now
   keeps the grid best unless the refined λ both fits and scores better.
   Refinement must never be able to lose a fit we already have.

**R cross-check fixture** emitted to the session scratchpad:
`gam_xcheck_data.csv` (400 rows, non-monotone truth), `gam_xcheck_ts_pred.csv`
(41-point grid), `gam_xcheck.R` (runs mgcv with the TS engine's own knots,
prints a side-by-side table, and contrasts loess leaving [0,1] on the same
data). Reference fit: k=10, λ=2.670943e4, edf=4.650036, deviance=313.542816,
interior λ, CI range [0.0288, 0.9780]. Note λ is reported on each
implementation's own penalty scaling and need not match mgcv's `sp` digit for
digit — **the curve and the edf are the comparison that matters.**

**INTEGRATION LANDED 2026-09-21.** GAM is the FIFTH ADR-0013 family and the
third consecutive confirmation that adding one needs an adapter only: the whole
18-scenario snapshot battery moved in exactly ONE place (s12's binary panel,
which is the loess→GAM change itself). s13–s17 were byte-identical.

- `EndpointFit` gained `{ kind: "gam"; model: GamFit }`; `curveFor`,
  `describeFit`, and the readout's `fitAt` each gained one branch.
- **Eligibility is now a DECLARATION, not a chain of conditionals.**
  `MODELS_BY_DATA_KIND` in `apps/demo/src/endpointAnalysis.ts` is the single
  source for both the Endpoint Models option list and `fitForCohort`'s
  fall-through: `binary: [logistic, gam]`, `continuous: [linear, loess, emax]`.
  This REPLACED three separate ad-hoc guards (loess unguarded, emax with its
  own `isContinuousEndpoint` check, the select's ternaries). An ineligible
  stored choice resolves to the kind's native family — the table's first
  entry — which is why the loess→GAM swap needs no migration path. Pinned by
  `apps/demo/src/modelEligibility.test.ts`.
- User-facing tuning: `k` (basis dimension), same per-endpoint pattern as loess
  span/degree and the Emax toggles; `gamSettings` persists in the session.
  λ itself is REML-selected, not user-set — deliberately.
- Snapshots: s12 renamed to `s12-smoothers-binary-gam-continuous-loess`
  (GAM on icgi, loess on brls — one smoother per data kind; the baseline was
  `git mv`'d so the before/after reads as a content diff, not delete+add), and
  s18 `s18-gam-binary-bounded` added as the focused containment case.

**Measured before/after on real icgi/AUC (this is the acceptance evidence):**

| cohort | loess span .75 | loess span .50 | GAM k=10 |
|---|---|---|---|
| Full N=704 | CI to **1.328** | CI **−0.008**–1.377 | est .441–.905, CI .208–.995 |
| SEX=1 N=282 | est to **1.067** | est to **1.071** | est .301–.99999762, CI 7.8e-6–1.0 |
| SEX=2 N=422 | CI to **1.076** | CI to **1.272** | est .518–.898, CI .442–.983 |

Loess leaves [0,1] in every cohort; GAM in none.

**One honest caveat, do not "fix" it by clamping:** on SEX=1 the upper CI
prints as exactly `1`. That is float64 saturation of `logistic(η)` for large η,
not an out-of-range value — the estimate there is 0.99999762 and the lower
bound 7.8e-6. Cause: the top decile of that cohort's exposure holds **N=1**
(a single event at AUC 342.7), so the band correctly says "no information out
here." A CI spanning nearly (0,1) over an unsupported region is the right
answer; 1.071 as a POINT ESTIMATE was not.

**Vision item newly logged (2026-09-20, not the current work item — do not
conflate): time-to-event / Kaplan–Meier is part of the long-term roadmap.**
User: "remember that time to event kaplan meier are part of the vision." No
scope, timeline, or design attached yet — this is a marker so a future
family-adding session (a fifth-plus ADR-0013 family, presumably needing
`renderer`'s already-scaffolded `StepStyle` curve style and a genuinely
different observed-summary shape — censoring, not x/N or mean±CI) doesn't
start from zero. Raise it explicitly once the binary-GAM replacement ships.

**Additional tests to run before/while building (per the user's explicit
ask "any additional tests needed"):**
- ~~Snapshot the CURRENT binary-loess output as an explicit "before"~~ — DONE
  via the `git mv`'d s12 baseline (content diff, reviewed leaf-by-leaf: only
  `readouts[0]` and `stacks[0].svg` moved; the continuous/loess panel was
  byte-identical) plus the new s18.
- ~~R cross-check recipe to prepare~~ — DONE, see the fixture above. The basis
  was pinned to `bs="cr"` with mgcv-exact knot placement, the same way
  `surface="direct"` was pinned down for continuous loess.

### Git hygiene reminders (do not relearn these the hard way again)

- `claudetwoexposureoneendpoint.R` is TRACKED by git (not gitignored — an
  earlier attempt to gitignore it was a no-op since git already tracks it)
  but must NEVER be staged. Always `git add` explicit file paths, never
  `git add -A` or `git add .`.
- Both `apps/demo/scripts/verify-build.mjs` (local) and
  `.github/workflows/deploy-demo.yml` (CI) maintain independent, hand-written
  package build lists — a new `packages/model-*` needs to be added to BOTH
  or the CI build fails with `Cannot find module` on a fresh checkout
  (happened twice this session: model-loess/model-emax were both missing
  from one or the other at different points).
- `apps/demo/src/data.generated.ts` is gitignored; regenerate via
  `node apps/demo/scripts/build-data.mjs` after touching
  `apps/demo/data/icgi.csv`.

---

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
**ORPHAN-PROJECTION FALLBACK EXTERMINATED (2026-09-03) — I8 addendum:** the
small-groups test protocol (run headlessly, all tiers PASS) caught the
continuous painter's samplesForGroup legacy fallback (suffix/dose/first-curve)
drawing an ABSTAINED group's projection markers + observed pill on a FOREIGN
curve (binary never had orphans — per-curve attachment). Rule: projection
renders iff curveKey structurally matches a curve; orphans render nothing
(points still highlight, readout still speaks). One `ridableProjected` filter
gates bands/lines/markers/pill/callout-hosts; dead `level` plumbing deleted.
s13 diff = exactly the orphan geometry (2 groups, 12 circles, 4 hit areas) on
the brls stack; re-baselined. User mixed-scales visual pass PASSED (readout
layout-invariance confirmed across endpoint-rows / columns / compare).

**USER TEST PASS 2026-09-17 (post-break, itemized feedback):**
- Item 1 CONFIRMED BUG: per-COLUMN strips under color=Endpoints render
  NEUTRAL (screenshots: endpoint columns, icgi/icgi2 strips both gray). Fix:
  a strip serving ONE endpoint wears that endpoint's color (constancy);
  collapsed shared rows-strip stays neutral by design; color-split checkbox
  stays disabled under endpoint facets (sub-rows redundant there). NEXT UP.
- Item 2 PASSED: degenerate norm bounds (brls 23–23) fail soft + honestly —
  legend flags "scale invalid", panel falls back to native scale, no NaN.
  E2c logged edge CLOSED as verified-safe.
- Item 3 PASSED: loess R parity — predict(surface="direct") @ AUC 94.2/173.7
  = 23.27986/23.11810 → app 1-decimal 23.3/23.1. Loess family fully verified.

**LINETYPE LAW B LANDED (2026-09-17, user ruling "no gating, no special
cases"):** absent linetype = NONE (unmapped channel paints nothing); mapped
endpoints = identity dash UNCONDITIONALLY (old cell-count/color=endpoints
gates deleted); mapped variable = positional scale trained on filtered base
cohort (same training rule as variable color — a lone filtered level takes
position 0 = solid AND first palette color; symmetric, not special). Overlay
preset WRITES linetype:endpoints into its spec (presets are spec-writers).
UI default "(none — all solid)". Baseline diffs machine-verified dash-attrs-
only: s4 gate-dash removed, s12/s13 brls identity "4 3" appears in faceted
cells (linetype explicitly mapped there); s1–s3 byte-identical via the
preset-written mapping. Legacy sessions without linetype now resolve none
(user-accepted).
**ITEM-1 FIX LANDED (2026-09-17): endpoint accent by constancy over the
mark's scope.** Domain: DistRowPolicy gains palette "endpoint"+endpointId
(single-endpoint cell under color=endpoints); demo resolveDoseRowPaint takes
the strip's endpoint scope (readoutEndpointIds) — per-column strips wear
their endpoint's ink, collapsed rows-strips stay neutral. Projection accents
follow the same decider in BOTH painters (the binary color=endpoints branch
had skipped resolveDoseRowPaint — I7 symmetry restored). Snapshots s15/s16
pin both halves; s1–s14 byte-identical (the bug area was unpinned — that is
how it survived). Battery: 16 scenarios.
**EMAX LANDED (2026-09-18) — ADR-0013's fourth family, contract proven a
second time:** `packages/model-emax` (dependency-free, grid+golden-section
fitting with NO starting values — the ggquickeda pain point this directly
targets). CONTINUOUS ENDPOINTS ONLY (binary Emax designed then parked by
user — see project memory / .ai/INVARIANTS.md). Two toggles: estimate γ
(default off) and estimate E0 (default on; off = no placebo/SoC anchor, E0
fixed at 0; sign of Emax alone decides inhibitory). CI = delta-method band
(loess precedent: both CI settings draw it, bootstrap is future work). NEW:
universal `describeFit()` in main.ts (switches on EndpointFit.kind, all 4
families) — equation+params via (a) readout-line title tooltip (per-fit
correct even on a shared strip) and (b) a live preview line under every
Endpoint Models select, refreshed on ANY settings change (loess span/degree
included — symmetric treatment, not Emax-only). Snapshot s17 pins the
fourth-family proof; s1–s16 byte-identical — zero pipeline changes, only a
new adapter. Also fixed: verify-build.mjs was missing model-loess AND
model-emax from its package list (worked before only via a stale local
dist/); both added.
**USER R CROSS-CHECK (2026-09-19):** `nls()` on real BRLS/AUC → "singular
gradient" (fails). `minpack.lm::nlsLM()` "converges" to EC50 = −14 (nonsensical,
outside AUC range), RSS 52168 — WORSE than a flat-line null model (RSS 17455).
Our own fit ties the null model (RSS 17448) with EC50 pinned to the grid's
lower edge. Conclusion, independently triple-confirmed: BRLS genuinely has no
Emax-shaped signal vs AUC; R's local optimizer fell into exactly the trap this
design exists to avoid. Simulated well-behaved data (E0=20/Emax=15/EC50=80)
recovered all three params within 1 SE, cross-checkable in R (CSV + R script
sent to user).

**BOUNDARY-PINNED WARNING LANDED (2026-09-19) — the follow-up from the above:**
a best grid index sitting at EITHER edge (EC50 or γ) means the golden-section
refine could not escape the coarse grid's outer bound — the honest signature
of a poorly-identified parameter. `EmaxFit.ec50Boundary`/`gammaBoundary:
"lower"|"upper"|null`; `describeFit`'s shared shape gained an optional
`warning?: string` (universal slot, only Emax populates it today). Surfaced
on BOTH existing display sites (readout tooltip + Endpoint Models preview,
new `.endpoint-model-warning` block) — neither is part of the snapshot
capture() shape, so all 17 baselines stayed byte-identical (verified).
model-emax tests: 17 (was 14) — 3 new pin the step-only/well-identified/
γ-sharp-step cases.

**ICGIEMAX SYNTHETIC ENDPOINT LANDED (2026-09-19):** a new continuous
endpoint baked into `apps/demo/data/icgi.csv`, keyed to each row's real AUC
(E0=10, Emax=25, EC50=90, γ=1.4 — deliberately non-1 so "estimate γ" has
something genuine to recover; noise SD=3; seeded/reproducible). All wiring is
data-driven (CSV → build-data.mjs → datasetContext.ts → columnMapping.ts's
EFFICGI_DEFAULT_ROLES) with zero per-endpoint-name special cases — color/
dash/label fall back to the same generic mechanisms icgi7 already uses;
defaults to Linear like any continuous endpoint, user picks Emax themselves.
All 17 snapshots stayed byte-identical (an available-but-unselected endpoint
is fully inert to existing defaults — verified).
**PROVENANCE CHECK CLOSED (2026-09-19):** re-verified — 176 missing CRCL rows
(25%), consistent across the raw bundled CSV, the generated dataset, and the
app's own mapping-panel display. User confirmed 176 matches their R-side
count now; the old "177 vs 176" discrepancy is resolved (most likely a side
effect of the QA-round-13 missing-as-zero bin fix or the later I9
"(missing)"-level work, neither of which explicitly closed this backlog line
at the time). No code change needed.
**E3 RE-CHALLENGE LANDED (2026-09-20):** user's sharp catch — endpoints on
ROWS blocked "Color-split boxplots" entirely (hard hard-coded
`layoutHasEndpointFacet` gate), while the SAME shared strip split fine by a
covariate in the identical layout. New `endpointStripsAreDistinct(spec)`
(true only for endpoints-on-COLUMNS) replaces the gate at `panelEndpointMode`
and `distEndpointColorSplit`; rows-faceted collapsed strips can now split by
endpoint exactly like the variable channel always could — no facet-based
exception. Self-inflicted regression caught mid-fix (s16 diverged: the same
`multiCurve` boolean was silently answering a SECOND, different question —
"is this a genuine unfaceted overlay" — for `omitPerEndpointFitInReadout`/
`useNeutralDoseLabelsInChrome`; split via `multiCurveOverlaid =
multiCurve && !layoutHasEndpointFacet`). All 17 baselines confirmed
byte-identical after the full fix; domain tests 49 (was 44). End-to-end
verified live: rows-faceted icgi+icgiemax, checkbox now enabled, toggling it
produces colored icgi/icgiemax split sub-rows.
NEXT: eventually the deferred GAM-based binary loess redesign (see project
memory) — no other queued backlog items.

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
