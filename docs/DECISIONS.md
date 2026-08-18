# Architectural Decisions

ADR-0001 Wide datasets are canonical.

ADR-0002 Statistics and visualization are separate.

ADR-0003 SVG is the primary rendering target.

ADR-0004 Every analysis is reproducced via session files.

ADR-0005 Models and visualizations are plugin-based.

ADR-0006 `packages/domain` is the root dependency of the project: pure
TypeScript interfaces and types only, no statistical or rendering logic,
no imports from any other package in this repo. Every other package may
depend on it; it depends on nothing here.

ADR-0007 `packages/statistical-engine` is renamed `packages/analysis` and
realizes ADR-0005 concretely: `AnalysisModel` is the plugin contract every
model family (logistic, linear, emax, ordinal, Kaplan-Meier, Cox, clinical
utility) implements; `ModelRegistry` discovers plugins; `PredictionSurface`,
`Diagnostic`, and `ConfidenceInterval` describe how a fitted model is
queried. Statistics become an implementation detail of a plugin, not of
this package - no concrete model ships in `packages/analysis` itself.

ADR-0008 Each model family plugin is its own package (e.g.
`packages/model-linear`), depending on `packages/analysis` for the
interfaces and `packages/domain` for shared vocabulary, but never on
another plugin or on `packages/analysis`'s deprecated legacy code.
`packages/model-linear` is the first: single-predictor OLS for continuous
endpoints, proving `AnalysisModel`/`ModelRegistry` end to end.

ADR-0009 `packages/visualization-engine` is replaced by `packages/renderer`,
built around a `Renderer`/`Layer` composition model rather than one
monolithic chart function per endpoint type. A `Renderer` composes an
ordered list of `Layer` instances (Axis, Grid, Scatter, Fit,
ConfidenceRibbon, ObservedStat, Distribution, Annotation) against a shared
draw context; `SVGRenderer` is the concrete implementation of ADR-0003's SVG
target, and `CanvasRenderer` is an intentionally unimplemented placeholder
for a future non-SVG target.

Layers consume plain domain vocabulary, not analysis-layer contracts:
`CurveSample` is an alias of `packages/domain`'s `PredictionPoint`, the same
shape already used by persisted `Prediction.points` (ADR-0004), so a
live-sampled curve and a session-replayed curve render through one path.
`packages/renderer` depends only on `@er-explorer/domain` - never
`@er-explorer/analysis`, `@er-explorer/data`, or React. Reconciling a live
`AnalysisModel`'s `PredictionSurface` + `ConfidenceInterval[]` into a
`CurveSample[]` is not the renderer's job - it's the calling application's
responsibility, or a small non-computational helper (`sampleCurve`) in
`packages/analysis`, which already owns both source types. The same
principle holds for `Distribution`'s violin shape: KDE/bandwidth selection
happens upstream of layer construction, never inside the renderer.

Interaction is not a Layer. Layers may optionally register inert markers
and hit-regions into the draw context while rendering; the Renderer resolves
marker layout once, across every layer, after all layers have run. Turning
hit-regions into live pointer/keyboard behavior is the job of a separate
`InteractionController`, not part of core Renderer/Layer, and not required
to live in `packages/renderer` - it stays in `apps/demo` unless a second
consumer proves the shape general rather than DOM-specific.

`packages/renderer` was built and proven in isolation (Phases 0-3), then
`apps/demo`'s four call sites were cut over one at a time - continuous
scatter (Phase 4), binary/logistic scatter plus Compare Endpoints (Phase 5),
the exposure-by-dose distribution strip (Phase 6) - with
`packages/visualization-engine` kept working throughout, and the old
package deleted only once every call site had moved (Phase 7). See
`docs/RENDERER_ARCHITECTURE.md` for the full design record.

ADR-0010 Layout visual encoding and selection (2026-08-07).

Guided and Advanced share one serializable `ViewLayoutSpec`. Guided
controls are **presets** that write spec fields; they are not a parallel
rendering mode.

**Grouping:** Endpoint is a normal layout dimension (`LayoutDimension`
endpoints) and a normal color encoding (`ColorEncoding` kind `endpoints`).
Users may facet, color, and (future) style lines by endpoint or covariate;
invalid combinations are warned in UI, not silently rewritten.

**Multi-curve cells:** When `color.kind === "endpoints"`, two or more
endpoints are selected, and the panel has no endpoint facet key,
`ScatterPanelSpec.endpointIds` lists curves in one cell (`panelEndpointMode`
`multiColor`). When endpoints are faceted, each cell is single-endpoint;
`color.kind === "endpoints"` still tints that cell with that endpoint's
color.

**Distribution split:** Side-by-side shapes within a dose row follow
`distribution.colorDistShapes` and the same color encoding: split by
endpoint ids when coloring by endpoints in a multi-curve cell; split by
levels when coloring by a variable. There is no separate long-term
"compare dist" flag — Guided "Split distribution by endpoint" preset sets
`colorDistShapes` (and linkage as today).

**Visual policy:** Pure functions in `@er-explorer/domain`
(`resolvePanelVisualPolicy`, `resolveDistVisualContext`) derive scatter
point source, dist split mode, projection accent rules, and readout flags
from spec + panel. The demo maps policy to palette (`apps/demo/src/layout/
resolvePanelStyle.ts`). Paint paths must not branch on ad hoc
`compareEndpoints` booleans when spec is available.

**Selection (phase 2):** Dist row clicks will serialize as
`dose` or `dose|suffix` where suffix is an endpoint id or covariate level;
one resolver feeds readout, projections, and cohort highlight.

See `.ai/LAYOUT_AND_ENCODING.md` and `.ai/ARCHITECTURE_REVIEW.md`.

ADR-0011 Overlay cohort scope (2026-08-08).

Reference splits and split-driven overlays must use explicit **cohort
scopes** derived from `ViewLayoutSpec` + panel (`resolveOverlayCohortPolicy`
in `@er-explorer/domain`), not ad hoc `dataFilteredRowIndices()` in paint
paths.

**Default:** For each scatter/dist cell, **facet cohort** =
`panel.rowIndices` ∩ data filters. Observed rates/means at split x,
Min/Max display lines, distribution split N annotations, and fitted
readouts at splits use **panel facet** (or **color level within panel**
when `color.kind === "variable"` and that variable is not faceted away).

**Exception — split x positions only:** Median/tertile/quartile **cut
points** on exposure are computed on the **endpoint × exposure metric**
population (union of panels sharing that endpoint slice and x metric,
with existing PK placebo exclusion for cut-point math). All panels with
the same endpoint and metric share the same vertical split **x**; **y**
callouts at those x still use facet/color cohorts.

**Linked x-domain:** Unchanged (per exposure column, ADR-0010 demo
behavior).

**Demo:** `apps/demo` maps scopes to row indices (`rowIndicesForReferenceSplit`,
`cohortForPanel`); overlay computors take `endpoint` + cohort arguments.

See `.ai/OVERLAYS_AND_SPLITS.md`.

ADR-0012 Unified encoding grammar (2026-08-16).

Supersedes the encoding portions of ADR-0010 and the cut-point exception
of ADR-0011. Full design record and decision log:
`.ai/ENCODING_V2_RETHINK.md`.

**Grammar:** A layout assigns grouping variables to five roles: `y`
(endpoints), `x` (exposure metrics), `facet_row`, `facet_col` (nesting
allowed; every strip labels its variable), and `color` (one variable).
Endpoint, exposure metric, study, dose, and covariates are all ordinary
grouping variables. `linetype` is an optional extra channel the user maps
to endpoint or to the color variable (double encoding for color-blind
safety), or leaves off.

**Legality — the scale-bearing rule:** endpoint owns the y scale; exposure
metric owns the x scale. A scale-bearing variable with more than one level
in play must either be faceted along its axis or have all levels share a
compatible scale to overlay. Exposure metrics therefore always facet
(never two metrics on one x-axis). Endpoints overlay only on a shared
scale: binary endpoints natively; continuous endpoints via the explicit
per-endpoint rescale to [0,1] configured in the Analysis drawer (bounds +
"Use data"). Values outside declared bounds are rendered as-is with a
user-facing warning — the app never clamps, drops, or edits data.
Direction of effect is always shown raw (AEs may be higher-is-worse);
alignment/inversion is CUI's job later via desirability weighting. All
scale-free combinations are legal, including the same variable on facet
and color simultaneously (degenerate but useful: stable level colors when
toggling between overlaid and faceted views).

**One categorical color channel per view:** the `color` mapping has
exactly one meaning everywhere on screen. Elements grouped by the color
variable take the palette; everything else renders neutral ink. The
selection highlight is a separate state accent. There are no other
palettes on the canvas (replaces the legacy neutral-dist special cases
with a single rule).

**Cohort contract:** enumeration produces cells; one domain resolver
produces per cell: facet cohort (facet slice ∩ filters), the color groups
present in it, split x positions, linked x-domain, and selection. Every
layer — points, curves, observed summaries, min/median/max markers,
fitted-at-split, dist rows, annotations, projections, readout — consumes
only this context, computed per (panel, group). No paint path may call
global filtered indices or global fit caches.

**Split cut points:** median/tertile/quartile x positions are computed per
**exposure metric** on all available exposure values, all doses pooled,
excluding placebo/standard-of-care/zero-by-design arms. Endpoint
missingness does not shrink the cut-point cohort; one set of split lines
per panel. (Simplifies ADR-0011, which scoped positions to endpoint ×
metric.) Y-callouts at those x remain per (panel, group).

**Distribution strip:** describes exposure, not endpoints. It renders once
per exposure column; rows are dose arms, subdivided by the color variable
when one is active (sub-rows take the palette; under color=endpoints rows
are neutral — dose identity is the row label). Per-endpoint strips appear
only when endpoint missingness makes contents genuinely differ
(exact-match dedup; near-match shows both). Row N = unique patients;
per-endpoint numbers (x/N binary, mean [CI] continuous) live in callouts
and readout only — no patient is counted twice. Shapes (box, lineranges,
KDE) never extend beyond observed min/max; KDE is kept (multimodality)
but trimmed at the data boundaries.

**Model registry:** each endpoint has a model family (logistic, linear,
loess now; bounded binomial smoother, Emax, ordinal P(Y≥k) planned) with a
per-endpoint user override. Fits are produced per (panel, group) — every
family supports fit-by-group. The observed-summary layer is driven by
endpoint TYPE, not model: binary → x/N (Wilson), continuous → mean ± CI
per bin; loess-on-binary keeps x/N observed bins. Smoother curves are
never clamped to [0,1]; the axis pads to show overflow. Loess CI comes
from prediction SE with a t multiplier. The layer API reserves room for
parameter overlays and fit-equation text (slope/intercept, EC50/Emax).

**Fixed marker vocabulary:** circle = observed by dose; triangle/diamond =
observed at exposure-quantile bin; shape is never user-mapped; size may
scale with N.

**Guided = presets:** P1 one endpoint × one exposure; P2 endpoints as rows
× exposures as columns; P3 endpoints overlaid per exposure column
(rescale as configured). Covariate color/facet/fit-per-group is Advanced
only. Both modes write the same spec; one render path.

**Selection and session:** one serializable selection type in domain feeds
readout, projections, and highlights. Sessions persist the full spec +
selection; pre-v2 `.erx` files are not migrated (explicitly accepted).

**Dropped:** the Guided overlay mount and `compareEndpoints` /
`compareDistByEndpoint` / `endpointOverlay` booleans; all neutral-mode
special cases (subsumed by the one-channel rule); `layoutColorFacetConflict`;
"shared by exposure column" as a user choice (now a derived dedup
outcome); dist color heuristics incl. `distUsesEndpointColorWhenUnsplit`;
hardcoded endpoint color/dash maps (ordered palette from dataset order);
ghost curves; user-mapped point shapes.

Implementation follows `.ai/ENCODING_V2_RETHINK.md` §F: domain resolver +
tests first, then the single demo paint path, dist geometry, session.

ADR-0013 Model-family adapter contract (2026-08-17).

Motivated by the most expensive bug class of the encoding-v2 QA campaign:
features implemented per model family drifted apart (fit-per-color existed
for logistic but not linear; split-row projections existed for binary but
not continuous; binary and linear disagreed on endpoint-missing rows).
Each divergence was caught by a human comparing two families by eye, which
does not scale as Emax, ordinal, and bounded smoothers arrive.

**Contract:** every selection, projection, overlay, callout, strip, and
readout behavior is written ONCE, parameterized by an
`EndpointFamilyAdapter`. A family implements only:

- `fit(rows)` -> model (per curve group; any cohort);
- `curve(model, xDomain)` -> samples with CI;
- `fittedAt(x)` -> estimate with CI (split/bin markers, readout fit lines);
- `observedSummary(rows)` -> {center, lower, upper, n, label} (x/N Wilson
  for binary, mean +/- CI for continuous, P(Y >= k) set for ordinal);
- `readoutFormat` (decimals, unit labels).

Pipelines may not branch on family beyond selecting the adapter. Rows fed
to any family are endpoint-finite under the same rule. Curves never clamp;
axes pad (ADR-0012).

**Conformance matrix:** one parameterized test suite runs the SAME scenario
set (facet x color x split x dose-click) against every registered family
and asserts structurally identical outputs: curve-group count and color
keys, per-curve projection association, cohort Ns, readout group labels.
Adding a family means implementing the adapter and appearing in the matrix
- "does linear behave like logistic" becomes CI, not manual QA.

Implementation is staged: the current demo keeps its two families on the
shared selection pipeline (rowsForDistGroupId / colorForDistGroupId /
updateReadout); the adapter extraction lands with the compare-painter
convergence (Slice E/F) rather than as another parallel path.

Full invariant catalog with per-bug history: `.ai/INVARIANTS.md`.
