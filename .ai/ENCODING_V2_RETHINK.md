# Encoding v2 — full rethink (assumptions, legality, simplification)

**Date:** 2026-08-13
**Status:** ANALYSIS ONLY — user gathering feedback; nothing implemented. Supersedes incremental patching of `main.ts` heuristics if approved.
**Trigger:** Manual QA session found the encoding/cohort logic "broken and not extensible" across five distinct layouts. User directive: rethink the whole model around the real analytical questions before any further fixes.

---

## A. Bug catalog from this QA session (evidence, not yet fixed)

| # | Symptom (screenshot) | Root cause (verified in code) |
|---|---------------------|-------------------------------|
| 1 | **Boxplots all one color** — Advanced, endpoints rows × exposure cols, color=Endpoints, dist "Shared by exposure column": both dose boxplot strips solid blue | Shared strip is linked to *one* scatter panel (the first, icgi) and `distUsesEndpointColorWhenUnsplit` paints all rows with that panel's endpoint accent. A strip shared across endpoint rows has no single endpoint — heuristic is unanswerable as posed. (Partially narrowed 2026-08-13 by requiring `!multiCurve`, but shared strips linked to single-endpoint panels still take one endpoint's accent.) |
| 2 | **BRLS not fit separately by sex** — color=sex + "Fit separately per color group": icgi gets two sex curves; BRLS gets one pooled dashed line | `fitByColor` loop exists only in the **binary** paint branch (`main.ts:3232`). The continuous branch builds a single curve; no per-level fit loop exists for linear endpoints. Points in the continuous branch also color by endpoint/dose only (`main.ts:3200`), not by variable. |
| 3 | **Facet + color on the same variable blocked** — user wants sex facets AND sex colors so each level keeps its "cognitive ID" color when toggling overlay ↔ faceted | `layoutColorFacetConflict` (`viewLayoutState.ts:110`) treats it as a conflict and silently falls back to dose colors. This was a design decision (ADR-0010 era) the user now explicitly rejects. |
| 4 | **Dist shapes overflow the data range** | KDE sample grid padded by `max(2.5 × Silverman bandwidth, 2% of range)` (`main.ts:3774`) — shapes extend well past observed min/max, which reads as fabricated exposure. |
| 5 | **Compare overlay ignores facets** — sex facet columns: the two scatter panels are pixel-identical; only dist strips differ | The Guided-compare overlay mount path predates facet cohorts and never slices rows by facet. Same class as the ADR-0011 bug, unfixed in the overlay branch. |
| 6 | **Identical fitted callout in both facet panels** ("1.9 [1.7–2.3] N=97" in sex:1 and sex:2) | Fitted-at-split / fitted-at-bin readouts still computed on a wider cohort — the known ADR-0011 leftover ("fitted-at-split readout may still need cohort pass"). |
| 7 | **Dist panels overlap/garble** — endpoints rows × sex cols + mirrored dist: dose rows from different panels paint over each other | Mirror-grid dist layout doesn't handle two-dimensional facet grids; panel geometry assumes one dist row band per column. |
| 8 | **icgi7 / icgi2 same color** (`#DDAA33`) | Palette-index fallback collides with hardcoded `ENDPOINT_COLORS`; dataset gained `icgi7` after the map was written. (Task chip already spawned.) |
| 9 | **Binary + continuous endpoints overlaid on one normalized "Response (compare 0–1)" axis** | Compare overlay rescales heterogeneous endpoints onto a shared fake axis. Questionable feature: hides units, invites misreading. |

**Meta-observation:** none of these are isolated typos. Every one traces to the same architecture problem — *visual encoding and analysis cohort are decided per-feature by local heuristics instead of once by a shared model.* Fixing them one-by-one grows the heuristic pile (this is exactly how #1 happened: a flag added for one layout misfired in another).

---

## B. Assumption inventory — what the current system silently assumes

| # | Assumption baked in today | Verdict | Why |
|---|--------------------------|---------|-----|
| A1 | **Endpoint is special** — comparing endpoints is its own subsystem (overlay topology, `compareEndpoints`, `compareDistByEndpoint`, neutral chrome, endpoint dash map) | **DROP** | Endpoint is a grouping variable like sex or study. Its only real specialness is that it owns the y-scale (see C2). |
| A2 | Color variable and facet variable must differ | **DROP** (user override) | Same variable on both is degenerate but *useful*: stable per-level colors when toggling between overlaid and faceted views. Legal in ggplot; should be legal here. |
| A3 | Dist row color is decided by dedicated flags (`distUsesEndpointColorWhenUnsplit`, neutral-dist, accent overrides) | **DROP** | Dist rows must inherit the same color encoding as scatter, computed from the same resolved context. No dist-specific color logic at all. |
| A4 | Guided compare is a distinct mount/render topology | **DROP** | Guided = presets that write `ViewLayoutSpec`. One render path. (Already the approved direction; now blocking.) |
| A5 | A dist strip can be **shared across facet rows** ("shared by exposure column") | **RESTRICT** | Only coherent when no row facet exists (then it's the marginal by dose). With row facets, sharing forces an unanswerable "whose color/cohort?" question — bug #1. Rule: dist mirrors the facet grid whenever any row facet is active. |
| A6 | `fitByColor` applies only to variable-color and only to binary endpoints | **GENERALIZE** | Fit is computed per (panel cohort × color group) for **every** model family. One code path; model family chosen by endpoint type. Fixes #2 by construction. |
| A7 | Reference split **cut positions** computed per endpoint × exposure metric, not per facet/color (ADR-0011 exception) | **KEEP** | Clinically correct: "where is the tertile boundary" is a property of the analysis population for that endpoint+metric. Everything *evaluated at* those x's is per-cohort. |
| A8 | Placebo/reference arm excluded from PK-like exposure splits and dist shapes | **KEEP** | Correct pharmacology. Stays a data rule, not a paint rule. |
| A9 | Endpoints of different types can be overlaid via 0–1 normalization | **DROP or restrict** | Cross-type comparison belongs in facet rows (each with honest units). Overlay only when endpoints share scale semantics (e.g., two binary responders). |
| A10 | KDE dist shapes may extend past the observed range | **DROP** | Clamp shape support to [min, max] (renormalized/bounded KDE) or default to boxplot/lineranges, which cannot lie about range. |
| A11 | Selection is two parallel structures (`selectedDoses` Set + `selectedDistGroupIds` strings) | **REPLACE** | One serializable selection type in domain (already Phase-2 planned; folds into this redesign). |
| A12 | Dose is the canonical dist row axis | **KEEP** | Dose-arm rows remain the organizing rows of the exposure strip; color splits subdivide within a dose. |

---

## C. The unified model (proposed grammar)

### C1. Variables and roles

All of: **endpoint, exposure metric, study, dose, covariate (sex, age-bin, race, wt-bin, crcl-bin …)** are *grouping variables*. A layout assigns variables to **roles**:

| Role | Meaning | How many |
|------|---------|----------|
| `y` | response — an endpoint (or endpoint set) | ≥1 |
| `x` | exposure metric | ≥1 |
| `facet_row`, `facet_col` | small multiples | 0..n each |
| `color` | within-panel grouping (points, curves, dist sub-rows, callouts — all of it) | 0..1 |

### C2. The one legality rule (replaces the ad hoc matrix)

**Scale-bearing variables own an axis.** `endpoint` owns y; `exposure metric` owns x.

> A scale-bearing variable with >1 level in play must either be **faceted** (each level gets its own axis) or all in-play levels must **share a compatible scale** to be overlaid on one axis.

- Two exposure metrics (AUC, CMAX) → must be facet columns (never mixed on one x-axis). Already true today; now it's a stated rule, not folklore.
- Two binary endpoints → may overlay on one y (same 0–1 scale) *or* facet. Users choose.
- Binary + continuous endpoint → **must** facet (no normalized fake axis).
- Everything else (study, sex, dose, covariates) is scale-free: any role, any combination, **including the same variable on facet and color simultaneously** (degenerate encoding = one color per panel, colors stable across layout toggles — the user's requested workflow).

That single rule plus A7/A8 is the entire legality model. Everything currently expressed as disabled checkboxes, warning strings, and fallback colors either becomes legal or falls out of this rule.

### C3. One resolved context drives every layer

For a spec, enumeration yields **cells**; for each cell a single resolver produces:

```
CellContext = {
  panelId, endpointId, xMetricId,
  facetCohort,                        // rows: facet slice ∩ filters
  groups: [{ level, color, rows }],   // color levels present in facetCohort
                                      //   (no color → one group = whole cohort)
  referenceSplitXs,                   // from endpoint×metric population (A7)
  xDomain,                            // shared per x-metric column
  selection                           // domain selection type (A11)
}
```

**Every** layer consumes only `CellContext` — points, fitted curves (one fit per group when fit-by-group is on, pooled otherwise, *any* model family), observed %/N and mean callouts, min/median/max markers, fitted-at-split values, dist rows (dose × group), split annotations, projections, readout. No layer may call a global (`dataFilteredRowIndices`, global fit caches) directly. This is ADR-0011's principle promoted from "overlays" to *the* contract, and it kills bug classes #1, #2, #5, #6 structurally.

### C4. Distribution strip, restated simply

- Dist mirrors the facet grid whenever any row facet exists (A5). "Shared by exposure column" survives only in the no-row-facet case, where it *is* the mirror.
- Rows = dose arms; if color is active, each dose splits into per-level sub-rows colored by the encoding. The "Color-split boxplots" checkbox becomes a derived default (color active → split) with at most a "pool colors in dist" opt-out.
- Shapes never exceed [min, max] of that row's values (A10).

---

## D. Features to let go (make it simpler, not harder)

1. **Guided compare overlay topology** and its booleans (`compareEndpoints`, `compareDistByEndpoint`, `endpointOverlay`) — Guided becomes 3–4 presets that write the spec. Overlay-of-binary-endpoints remains reachable *through the spec* (C2 allows it).
2. **Normalized cross-type endpoint overlay** ("Response (compare 0–1)") — deleted. Cross-type comparison = facet rows.
3. **All neutral-gray encodings** (neutral dist shapes, neutral dose chrome, neutral projections) — an encoding either applies or the element uses its own group color. Gray "compare mode" states disappear with A1.
4. **`distUsesEndpointColorWhenUnsplit` and every dist color heuristic** — replaced by C3.
5. **The facet-color conflict guard** (`layoutColorFacetConflict`) — deleted; combination becomes legal and useful.
6. **"Shared by exposure column" as a user-facing choice** — becomes automatic (C4); one fewer dropdown.
7. **KDE overflow** — bounded shapes or demote KDE below boxplot/lineranges as default.
8. **Hardcoded `ENDPOINT_COLORS`/dash maps** — ordered palette from dataset endpoint order (fixes #8 permanently, not just for icgi7).
9. **Two selection structures** — one domain type.

**Deliberately kept:** package boundaries (domain/data/analysis/renderer/session), `ViewLayoutSpec` (extended, not replaced), panel enumeration in data, renderer layer system, ADR-0011 split-position exception, PK reference-arm rule, `.erx` sessions (with migration).

---

## E. Fit to the real use cases (the test of the model)

| User question | Expressed in the grammar |
|---------------|--------------------------|
| "Two exposures, one endpoint — which metric drives response?" | y=endpoint; x=AUC,CMAX as facet cols; color=dose |
| "One exposure, many endpoints — consistent story?" | endpoints as facet rows (honest units each) or overlaid if same scale |
| "Head-to-head across studies" | facet col=study (or row), color=study when overlaid; fits per group |
| "Does response differ by sex/age at a given exposure?" | color=sex (+ fit per group) → toggle facet=sex on/off **without colors changing** (A2 dropped) |
| "Sex effect per endpoint, per metric" | rows=endpoints, cols=xMetrics, color=sex — every cell shows two sex curves, callouts per sex per cell (C3) |

Nothing in these workflows needs a compare subsystem, neutral states, or dist color flags. The grammar covers them with 5 roles + 1 legality rule + 1 cohort contract.

---

## F. Recommendation: step back — yes

Stop patching `main.ts`. The last three sessions each fixed one heuristic and each fix misfired in an adjacent layout (bug #1 is literally the 2026-08-07 feature). The definitive fix is the resolver, and it subsumes the entire existing Phase-2 backlog (selection model, guided presets, session persistence, paint extraction) rather than competing with it.

**Proposed sequence (each step user-approved, per IMPLEMENTATION_RULES):**

1. **ADR-0012 draft** — the grammar of §C, the drop list of §D, migration notes for `.erx` and Guided presets. No code.
2. **Domain:** `resolveCellContexts(spec, dataset-shape) → CellContext[]` + selection type. Pure, heavily unit-tested (the facet×color×split matrix from OVERLAYS_AND_SPLITS.md becomes the test grid).
3. **Demo:** one paint path consuming `CellContext`; delete overlay mount, compare paints, neutral states, dist color flags. Generalize fit-per-group across model families.
4. **Dist geometry:** mirror-grid for 2-D facets (bug #7), bounded shapes (#4), derived split.
5. **Session:** persist spec + selection; migrate Guided booleans.
6. **Tests:** ui-smoke matrix per §E rows + "two facet panels must never show identical callout strings when cohorts differ".

Steps 2–3 are the rewrite core; 4–6 ride on it. The packages and renderer survive untouched in spirit; `main.ts`'s orchestration is what gets replaced.

---

## G. Decisions — ANSWERED by user (2026-08-13)

1. **Facet+color same variable:** ✅ **legal always**, level colors everywhere.
2. **Endpoint overlay + rescaling:** ✅ **KEEP overlay, including cross-type.** Rescaling linear endpoints to [0,1] is required (CUI work coming later). Rescale bounds are **explicit and user-controlled** per endpoint in the Analysis drawer (already exists: min/max + "Use data"). Nothing special about linear — up to the user to rescale. *This reverses §D item 2: normalized overlay is a feature, with the rescale contract made explicit in the spec.*
3. **KDE:** ✅ **keep** (shows multimodality) but **clamp to data boundaries** — no extrapolation beyond observed min/max. Boxplot/lineranges/KDE are the same info at different resolutions.
4. **Guided mode:** ✅ **keep as presets** — easy endpoint × exposure compare, no third-level splits. Advanced opens more facet/split/color/group possibilities on the same unified logic.
5. **Pooled dist / dedup:** ✅ the real goal is **removing redundant information**: when split dist rows are *identical* (same patients, same exposure values — e.g., per-endpoint rows of the same cohort), **auto-detect and collapse** to one row. **N = unique patients** — never count a patient twice across endpoint panels. Saves space/pixels; no duplicate dists.
6. **`.erx`:** ✅ **break now** — no back-compat requirement.

**Additional directive — model families:** unify fit logic across endpoints. Future model families beyond logistic/linear: **loess, Emax, others — even loess on binary data**. Logistic is just one model. The fit layer must be a pluggable (model family × cohort × group) contract; per-endpoint default model with user override (Endpoint Models UI already exists).

**Process:** user will supply reference visuals from their ggquickeda package on request. Open challenge round (§H) before drafting ADR-0012.

---

## H. Challenge round — ANSWERED via clauderesponse.docx (2026-08-16; images archived from docx)

| Q | Decision |
|---|----------|
| 1a | ✅ Normalized overlay axis stays label-light (0–1); native units in callouts/hover/readout. |
| 1b | No direction flag in rendering — raw direction always shown (endpoints can be AEs where higher = worse). **CUI handles direction later** via desirability functions / negative weighting. |
| 1c | Out-of-bounds after rescale "should not happen": proper normalization maps to [0,1]. If observed data fall outside declared bounds → **warn the user, render data as-is**; the app never edits/clamps data (not its job to do data management). |
| 1d | **Split cut points = per exposure metric, computed on ALL available exposure values** (all doses pooled), **excluding placebo/SoC/zero-by-design**. Endpoint missingness does NOT shrink the cut-point cohort (icgi2 missing 2 values → still use all CMAX values). One set of lines per panel/overlay. *This simplifies ADR-0011: positions are f(metric, PK-rule) — not endpoint×metric.* |
| 2a | ✅ Exact match collapses; near-match shows both. |
| 2b | **Never merge endpoint rows into a neutral row** — endpoints always keep separate identity/color (only CUI ever collapses endpoints). The dedup target is not row-merging but **not repeating the same strip** ("shared by exposure column" = avoid duplicate boxplots). Exact rendering rule re-asked — see §I.1. |
| 2c | User flagged confusion (continuous has no responders). Restated in §I.2: dist-row N = unique patients; per-endpoint summaries (x/N for binary, mean [CI] for continuous) live in callouts/readout. |
| 3a | **Linetype = optional user-mapped channel**: by endpoint OR by the color variable (double encoding for colorblind-safe), or none. Drop only if too ambitious. (Image: color=sex + linetype=sex double encoding.) |
| 3b | Nested facets OK — multiple row and column facet variables, provided every strip identifies its variable (ggh4x `strip_nested` reference images). |
| 3c | Shape is **not** a user channel — it distinguishes *stat identity*: observed-by-dose markers vs observed-by-exposure-quantile point-intervals (circle vs triangle in ggquickeda). Claude to advise best differentiation — see §I.3. |
| 3d | ✅ No ghost curves. |
| 4a | Observed layer per endpoint TYPE confirmed (binary → x/N even under loess). Open: smoother predictions can overflow [0,1] on binary — advice in §I.4. |
| 4b | Loess CI from `predict(se=TRUE)` + t-multiplier (user's ggquickeda code) — parametric-style band available; no bootstrap needed for v1. |
| 4c | ✅ Reserve layer room for **parameter overlays AND fit-equation text** (logistic/linear slope+intercept, EC50/Emax) as overlay lines or text. |
| 4d | ✅ Ordinal **in scope** — 0/1/2+ categories (P(Y≥k) curve sets); design the y-scale contract for it. |
| 5 | ✅ Presets P1–P3 confirmed; covariates = Advanced only. |

**Reference visuals (from user's docx, ggquickeda):** double-encoding linetype+color; nested strips both orientations; observed %/N per color group at splits (callout clashes are a known ggquickeda pain — app must handle collision better: stagger/hover/toggle); by-dose callouts disambiguated by boxplot projections; loess + dose-colored KDE ridges trimmed at min/max (trim itself buggy in ggridges — our no-overflow reference); real CUI example (Response/Neutropenia/DoseRed + CUI curves, dose boxplots below). User can supply the CUI R code as a zip.
**Context:** user built this app because ggquickeda static plots hit bugs/limits (SEX2/SEX3 fake-column workaround for same-variable-two-roles; ggrepel callout clashes).

## I. Round 2 — RESOLVED (2026-08-16, user said "go")

1. **Dist strip dedup + ONE-COLOR-CHANNEL RULE (2b, final).** The exposure-by-dose strip depends only on (exposure metric, cohort, color split); renders once per exposure column; per-endpoint strips only when endpoint missingness makes contents actually differ. User challenged dose-coloring the strip under color=endpoints (two palettes = cognitive overload) — **agreed and generalized**:
   > **One categorical color channel per view.** The `color` mapping has exactly one meaning everywhere. Elements grouped by the color variable get the palette; **everything else renders neutral ink**. color=dose → dose-colored strip rows (channel and row axis agree); color=endpoints → **neutral strip rows** (dose identity = row label); color=sex → sex-colored sub-rows. Selection highlight is a separate accent (state, not a channel). This is the principled replacement for the legacy "neutral dist shapes" special case.
2. **N display (2c):** dist-row N = unique patients with exposure in that dose (per level when split); binary x/N and continuous mean [CI] appear only in callouts/readout. Accepted.
3. **Shape (3c):** fixed stat vocabulary — circle = observed-by-dose, triangle/diamond = observed-at-quantile-bin; never user-mapped; size optionally ∝ N. Accepted.
4. **Smoother overflow (4a):** never clamp the curve; pad y-axis; registry has `loess` (unconstrained) now, bounded binomial smoother (GAM/logit) later as binary default. Accepted.

**Status: questionnaire closed. Plan approved ("go"). Next: ADR-0012 in docs/DECISIONS.md, then implementation per §F sequence.**

---

## Related

- [`OVERLAYS_AND_SPLITS.md`](./OVERLAYS_AND_SPLITS.md) — ADR-0011 cohort principle (generalized here)
- [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) — Critical items (subsumed by §F sequence)
- [`LAYOUT_AND_ENCODING.md`](./LAYOUT_AND_ENCODING.md) — prior target model (superseded by §C if approved)
- [`docs/DECISIONS.md`](../docs/DECISIONS.md) — ADR-0010/0011; ADR-0012 to be drafted after §G answers

## J. Grouping model — ADOPTED (2026-08-21, supersedes fitByColor)

1. **GROUPING is explicit and statistical** (ggplot2 `group` analog): spec field
   `grouping: { variableIds: string[] }`; curves/fits exist per endpoint × declared
   group. Endpoint is not a grouping choice (it is the y variable). `fitByColor`
   DELETED. Migration: `fitByColor && color=variable(v)` → `grouping:[v]`, else `[]`.
2. **CHANNELS are paint, never statistics** — color/linetype partition marks
   (points, strip rows, observed markers), never fits.
3. **Constancy theorem:** a curve wears a channel's encoding iff the channel's
   variable is constant within the curve's group. Derives: neutral pooled curve
   with colored points; degenerate facet+color level-colored curve; group-without-
   channel (identical-looking curves) is legal — user's responsibility.
4. **Strip rule (provisional, user will re-challenge after grouping lands):**
   strips are x-marginals with no fits → sub-rows stay CHANNEL-driven; curves are
   GROUPING-driven; I8 bridges (a clicked dose×level row projects onto its group's
   curve — pooled if the level is not in the grouping).
5. **I8 restated:** projection granularity = declared grouping.
6. **Callout density (decided):** control in Overlays, default **"Selected groups
   only"** (plot = extraction tool: click the subgroup to read its number), "All"
   on demand; persisted in session.
7. Ordinal look-ahead: P(Y≥k) multiples are family-internal (adapter emits k
   curves per endpoint × group), NOT user grouping.

## K. QA round 12 rulings (2026-08-22)

1. **Covariate binning includes placebo** (confirmed): baseline covariates (crcl,
   wt…) bin over ALL filtered rows; placebo exclusion applies only to EXPOSURE
   splits (exposure ≡ 0 by design). Verified vs user's R: app median crcl = 105.5
   over 528 non-missing ≡ R cut (0,106]; 176 missing ≡ R NA groups.
2. **Missing is an explicit level** (user ruling): rows with a missing covariate
   value form a first-class "(missing)" level — facet panel, strip sub-row, color
   level — gray ink, ordered last, never silently dropped (25% of the demo data
   was vanishing from crcl facets). Filters must make excluding missing EASY
   (one-click "exclude missing <var>" in the Filters menu).
3. **Cut-value transparency:** bin labels carry the number ("crcl ≤ 105.5") plus
   binning-basis annotation; opaque "≤ median" labels are a defect.
4. **Known bug (pre-existing, logged):** axis desync after boxplot click until a
   splitter resize forces re-measure — suspected scrollbar/readout-height width
   change mid-repaint; reproduce headlessly and fix in/before E2.
