# Renderer redesign: analysis and proposal

Status: **implemented - Phases 0-7 complete.** Originally written in response
to a request to rename `packages/visualization-engine` to `packages/renderer`
and rebuild it around a `Renderer`/`Layer` composition model; this document
analyses that literal request against the (now-deleted)
`packages/visualization-engine`, flags where it had gaps, and proposes the
design that was ultimately built. See ADR-0009 in `docs/DECISIONS.md` for the
short summary, and §8's migration-plan table below for what each phase
delivered.

## 1. Why this isn't a straightforward rename

`packages/visualization-engine` (1,489 lines, one file) does not consume the
domain layer's `PredictionSurface` at all today. It consumes a much older,
loosely-typed shape:

```ts
// packages/analysis/src/legacyStatistics.ts - literally named "legacy"
export interface PredictionResult {
  estimates: Array<Record<string, number>>;
  metadata: Record<string, unknown>;
}
```

`apps/demo/src/main.ts` bridges this gap itself: it calls the real plugin
architecture (`AnalysisModel.predict()` / `.confidenceInterval()`, from
`packages/model-linear` or the legacy logistic fitter) and then hand-zips the
results back into this legacy shape purely so the renderer can consume it.
Asking the renderer to consume `PredictionSurface` directly is really asking
to delete that bridge - a real architectural upgrade, not a cosmetic rename.

It also turns out `PredictionSurface` (from `packages/analysis`) can't be the
renderer's literal input type, because it deliberately carries no confidence
interval:

```ts
// packages/analysis/src/predictionSurface.ts
export interface PredictionSurfacePoint {
  exposure: number;
  estimate: number;
  endpointId?: string;
}
export interface PredictionSurface {
  readonly analysisModelId: string;
  readonly scale: "response" | "linear-predictor";
  evaluate(exposures: number[]): PredictionSurfacePoint[];
}
```

CI bounds are a separate concept (`AnalysisModel.confidenceInterval()` ->
`ConfidenceInterval[]`), by design - the doc comment explains this is so a
caller can request several CI methods (Wald vs. bootstrap) for the same
curve without forcing them into one point shape. A `Fit`/`ConfidenceRibbon`
layer needs both, merged by exposure - something has to do that merge, and it
isn't the renderer.

**The good news:** the merged shape the renderer actually needs already
exists, unused for this purpose, in `packages/domain`:

```ts
// packages/domain/src/prediction.ts
export interface PredictionPoint {
  exposure: number;
  estimate: number;
  lower: number;
  upper: number;
  endpointId?: string;
}
```

This is the same shape a **persisted, session-replayed** `Prediction.points`
already uses (ADR-0004). If the renderer's live-render input is this same
type, a replayed session and a freshly-evaluated model converge on one
render path - no special-cased "session replay" rendering code.

## 2. Recommendation: renderer depends on `domain` only, not `analysis`

| | Literal spec | Recommended |
|---|---|---|
| Renderer's curve input type | `PredictionSurface` (from `@er-explorer/analysis`) | `CurveSample` = alias of `@er-explorer/domain`'s `PredictionPoint` |
| Renderer's package dependencies | implies `@er-explorer/analysis` | `@er-explorer/domain` only |
| Who merges surface + CI into a curve sample | unspecified | a new `sampleCurve()` helper in `packages/analysis` (it already owns both source types; it's alignment, not computation, so it doesn't reintroduce statistics into anything) |

Rationale: this keeps `packages/renderer` a true leaf/presentation-tier
package - same tier as `packages/data`, which also depends only on `domain`.
It renders anything shaped like a `PredictionPoint[]`, with zero awareness
that a "fitted model you can query" concept exists. It also means a future
change to `ConfidenceInterval` (new CI method, new diagnostic field) can
never require touching the renderer.

**This is the biggest deviation from the literal request** ("the renderer
consumes PredictionSurface objects") and the one most worth confirming before
any code gets written.

## 3. Layer-by-layer critique

**Axis, Grid, Scatter, Fit, ConfidenceRibbon** - clean fits, ports mostly as
named, low risk.

**Fit vs. ConfidenceRibbon: two layers, not one.** Not just because the
current code happens to separate them - `confidenceInterval()` can be
unsupported by a plugin, unrequested, or expensive (bootstrap), so Fit must
render standalone; and "Compare Endpoints" plausibly wants N fit lines but
only the primary curve's ribbon (N overlapping bands is unreadable). Two
separately-instantiable layers is what makes both of those choices a
composition decision instead of an internal branch.

**ObservedStat: one generic shape, not a `mode` switch.**

```ts
interface ObservedStatBin {
  x: number;
  center: number;   // mean OR proportion - renderer doesn't care which
  lower: number;
  upper: number;
  n: number;
  label?: string;   // pre-formatted upstream: "34%", "12/34", "1.2 mg/L"
}
```

The renderer never needs to know "this is a responder rate" vs. "this is a
mean" - that's the caller's knowledge, expressed as a formatted label string,
not a branch inside the layer.

**Distribution: one layer, delegating to a shape strategy** (`BoxplotShape` /
`ViolinShape` / `LinerangesShape`), not three separate layers and not one
layer with an untyped mode flag. The three modes share real machinery
(per-group iteration, split-annotation overlay) that would otherwise be
copy-pasted across three layer classes - but lineranges genuinely can't
morph to/from the other two (no shared path geometry), which is exactly the
kind of fact a named, separately-exported strategy can express cleanly and an
if/else inside one layer can't.

*Bug to fix during this port, not after:* the current file computes KDE
density + Silverman bandwidth selection **at render time**, inline in the
chart function - a real "no statistical computations" violation, even though
the KDE math itself already lives in `@er-explorer/analysis`. Fix: the
renderer's `ViolinShape` accepts pre-computed `{x, density}` samples; whoever
constructs the layer (caller, or a small `analysis` helper) computes the KDE
first.

**Interaction: not a Layer - my strongest disagreement with the literal
spec.** A Layer is a stateless `(data, context) -> pixels` function, called
once per render. Interaction is stateful (hover/drag), event-driven, and
cross-layer (dose-click-projection touches Scatter + Fit + ObservedStat at
once; brush-select needs Scatter's own point geometry). Treating it as "just
another Layer" means either duplicating geometry other layers already
computed, or reaching into sibling layers' internals.

Also worth being precise about scope: today Interaction is **100% outside**
the renderer already - `apps/demo` queries the returned SVG's DOM for
`data-*` attributes and manually inverts pixel coordinates via the returned
scale metadata. Proposed model:

- Layers may optionally register **inert hit-regions** (rect/circle/path +
  id + opaque payload) into the shared render context while they draw - a
  side output, not a second geometry pass.
- The `Renderer` collects these into `RenderResult.metadata.hitRegions` -
  plain data, no DOM, no event listeners. Framework-agnostic by construction.
- A separate `InteractionController` (not part of core `Renderer`/`Layer`,
  not required to live in `packages/renderer` at all) takes a `RenderResult`
  and a mounted DOM node and does the actual event wiring. Recommendation:
  keep this in `apps/demo` until a second consumer proves the shape is
  actually reusable rather than accidentally DOM/SVG-specific.

## 4. Gaps the literal list would silently drop

- **Marker collision-avoidance** (`layoutMarkers`/`renderMarker`) is
  currently *global* across a whole chart - observed bins, reference-line
  labels, and (implicitly) any future markers all get laid out together so
  they never overlap. If each Layer resolves its own markers independently,
  cross-layer collisions come back. Fix: same treatment as hit-regions -
  Layers call `ctx.markers.add(...)` while rendering; the `Renderer` resolves
  layout exactly once, after every Layer has run.
- **Reference lines / split annotations** map to `Annotation`, but currently
  have their own bespoke label-staggering logic, separate from the general
  marker system.
  **Correction, made during the actual Phase 3 port (docs/DECISIONS.md
  wasn't wrong about the code existing separately, but this document
  overstated how much unifying it further):** re-reading the current
  renderer's `renderReferenceLines` more closely shows it was *already*
  separate from `layoutMarkers`/`observedMarkers` in the pre-redesign code,
  not one thing being artificially split into two - a reference line's own
  name label (top) and value label (bottom) are a two-row, x-only,
  fixed-anchor stagger, while `ObservedStat`-style markers are an
  x-clustered, vertically-free-floating dot+CI+label-box stack. These are
  genuinely different layout problems, and `AnnotationLayer` keeps its own
  algorithm for them rather than forcing a false unification. What *did*
  already share the marker stack in the old code - and still does in
  `AnnotationLayer` - is the opt-in "reference-line fit value" marker
  (`showReferenceFit`, e.g. `"Fit 0.74 [0.70-0.78]"`): that one goes through
  the exact same `ctx.markers.add()`/`resolveMarkers()` pool as
  `ObservedStat`, since the old code already put it in the same
  `observedMarkers` array. Net effect: one real simplification (the shared
  marker pool, built in Phase 3) plus one thing this document earlier
  implied would unify but structurally can't - now resolved rather than left
  ambiguous.
- **Multi-curve overlay ("Compare Endpoints")** isn't a gap once Fit/
  ConfidenceRibbon are independent, per-curve layers - "3 endpoints overlaid"
  becomes "3 Fit layers (+ however many ConfidenceRibbon layers) + one shared
  Axis/Grid," and the current code's bespoke "primary curve + N extra curves"
  special case goes away entirely. Worth calling out as a real simplification
  this redesign buys, not just a migration target.
- **Dose-click projection overlays** (Q1-Q3 emphasis + min/max markers) have
  no obvious single Layer. Proposed decomposition: two `Fit`-layer instances
  over the same `CurveSample[]` (one spanning min->max, muted; one spanning
  Q1->Q3, emphasized) plus a lightweight marker-point layer for the quantile
  dots, reusing the same marker machinery as ObservedStat. This is the piece
  I'm least confident about - if it proves clunky in practice, falling back
  to a dedicated `Layer` type for this specific case is a legitimate escape
  hatch, not a failure of the plan.

## 5. Interface sketch (signatures only, not full implementations)

```ts
// packages/renderer/src/types.ts
import type { PredictionPoint } from "@er-explorer/domain";
export type CurveSample = PredictionPoint;

export interface ObservedStatBin {
  x: number; center: number; lower: number; upper: number; n: number; label?: string;
}

export interface MarkerCandidate {
  x: number; y: number; label?: string; kind: string; ownerLayerId: string;
}
export interface HitRegion {
  id: string; layerId: string;
  shape: { type: "rect"; rect: PixelRect } | { type: "circle"; cx: number; cy: number; r: number } | { type: "path"; d: string };
  data?: unknown; cursor?: string;
}

export interface DrawTarget {
  drawLine(points: { x: number; y: number }[], style: LineStyle): void;
  drawArea(path: string, style: FillStyle): void;
  drawRect(rect: PixelRect, style: FillStyle): void;
  drawCircle(cx: number, cy: number, r: number, style: FillStyle): void;
  drawText(x: number, y: number, text: string, style: TextStyle): void;
  group(attrs: Record<string, string>, fn: () => void): void;
}

export interface DrawContext {
  readonly width: number; readonly height: number;
  readonly margin: { top: number; right: number; bottom: number; left: number };
  readonly plotRect: PixelRect;
  readonly xScale: Scale; readonly yScale: Scale;
  readonly markers: { add(m: MarkerCandidate): void };
  readonly interactions?: { add(h: HitRegion): void };
  readonly target: DrawTarget;
}

export interface Layer {
  readonly id: string;
  readonly kind: "axis" | "grid" | "scatter" | "fit" | "confidence-ribbon" | "observed-stat" | "distribution" | "annotation";
  render(ctx: DrawContext): void;
}

export interface RenderInput {
  width: number; height: number;
  margin?: Partial<DrawContext["margin"]>;
  xDomain: [number, number]; yDomain: [number, number];
  layers: Layer[];
}
export interface RenderResult {
  outputType: "svg" | "canvas";
  content: string | HTMLCanvasElement;
  metadata: { plotRect: PixelRect; xScale: Scale; yScale: Scale; markers: LaidOutMarker[]; hitRegions: HitRegion[] };
}
export interface Renderer { render(input: RenderInput): RenderResult; }

export class SVGRenderer implements Renderer { /* builds DrawContext, calls each layer, resolves markers once, serializes */ }

// Honest placeholder: the DrawTarget/DrawContext contract is fully specified so a later
// change only has to fill in per-layer draw calls, not redesign the interface. Bar for
// "not a stub": Axis/Grid/Scatter must actually work on Canvas, proving DrawTarget isn't
// secretly SVG-shaped. Fit/ConfidenceRibbon/Distribution/markers: explicitly out of scope.
export class CanvasRenderer implements Renderer {
  constructor(private readonly ctx2d: CanvasRenderingContext2D) {}
  render(_input: RenderInput): RenderResult {
    throw new Error("CanvasRenderer: not yet implemented (see ADR-0009 draft below)");
  }
}
```

Key point: `layoutMarkers`/`renderMarker` are called **once, by the
Renderer**, after every Layer has run - not by individual Layers. A Layer
that wants a marker drawn just calls `ctx.markers.add(...)`. Same treatment
for hit-regions. This is what preserves today's whole-chart collision
avoidance without any Layer needing to know about any other Layer.

## 6. Layer ordering: the missing grammar

Real gap, flagged after reviewing the interface sketch: an array of `Layer`
objects has no defined paint order beyond "whatever order the caller happened
to push them in." That's a footgun - nothing stops a caller from
accidentally putting `Scatter` before `ConfidenceRibbon` and getting the band
painted over the points. The current monolith avoids this by construction
(there's only one function, so there's only one order, hard-coded); a
composable `Layer` list needs an explicit rule or it inherits the same
footgun for free.

**Proposal: the `Renderer`, not the caller, owns paint order.** Every
`Layer.kind` has a fixed default rank in a small table the `Renderer` owns;
layers are sorted by `(rank, then array position as a tiebreak)` before
painting, regardless of the order they were constructed or pushed into
`RenderInput.layers`. This removes the "did I remember to order these
correctly" burden entirely for the common case. An optional per-layer
`zIndex` override stays available as an escape hatch for the rare case where
a caller genuinely needs to deviate (e.g. a stylistic choice to paint one
specific annotation behind a curve instead of in front of it).

Default rank table, reverse-engineered from the current code's own (implicit,
hard-coded, working) paint order:

| Rank | Layer kind | Rationale |
|---|---|---|
| 0 | `Grid` | Background chrome, always bottom |
| 5 | `Axis` | Chrome; grouped with Grid rather than today's mid-stack position (today axis paints after curves but before points, so tick labels can end up partly covered by a dense point cloud - moving it next to Grid is a small, low-risk visual improvement, not just a port) |
| 10 | `ConfidenceRibbon` | Band sits under everything that isn't itself chrome |
| 20 | `Fit` | Curve line sits over its own band |
| 25 | `Distribution` | Only relevant when sharing axes with a scatter chart (today it's usually a separate panel/strip, not an overlay) |
| 30 | `Annotation` | Reference lines - matches today's actual position (drawn after axis, before points) |
| 40 | `Scatter` | Raw points paint over the curve/band/reference lines, matching today |
| 50 | `ObservedStat` | Point-adjacent markers - conceptually "on top of the data," though see below |

Markers and hit-regions are **not** part of this per-layer rank table at all
- they're a separate, always-last system pass (§5), painted after every
`Layer.render()` call regardless of the layers' own ranks, exactly like
today's `renderMarkers()` call is the final thing appended to `parts` in
every current chart function. This table only governs the geometry each
Layer draws directly; the marker/hit-region system sits above all of it by
construction, not by rank number.

This resolves "no grammar for what goes first" without asking every future
Layer author to memorize or hand-order anything - the rank table is the
grammar, and it lives in exactly one place (the `Renderer`'s implementation),
not scattered across call sites.

## 7. Extensibility to endpoint/model types beyond binary and continuous

Worth designing for explicitly now, before the core vocabulary (`CurveSample`,
`ObservedStatBin`, the `Distribution` shape strategies) gets locked in by
Phase 1-2 code, since drug development's endpoint types go well beyond the
two this codebase currently supports (binary responder/non-responder via
logistic, continuous rating-scale via linear/OLS):

- **Time-to-event / survival** (Kaplan-Meier, Cox): a "curve" here is a step
  function (survival probability vs. time), not a smooth interpolated line -
  `Fit` would need to support a step-interpolation style, and `x` stops being
  "exposure" and becomes "time," which the current `exposure`-named fields
  (`CurveSample.exposure`, `ObservedStatBin.x`) don't obviously preclude but
  haven't been checked against either.
- **Ordinal/categorical** (e.g. a 5-level CGI-type scale modeled as ordinal,
  not collapsed to binary the way this demo currently does with
  ICGI/ICGI2/ICGI3): `Fit` would need one curve per level/category
  (cumulative-odds style), which the multi-curve-overlay mechanism already
  supports structurally - but `ObservedStat` bins would need a per-category
  breakdown, not a single center/CI pair.
- **Count/rate endpoints** (Poisson/negative-binomial - e.g. exacerbation
  rates): center + CI still fits `ObservedStatBin`'s generic shape, but the
  y-axis is often log-scaled, which touches `Scale` more than any Layer.
- **Multiple simultaneous exposure metrics or covariate-adjusted curves**
  (already partly present here as AUC vs. Cmax): the current `endpointId?`
  field on `PredictionPoint`/`CurveSample` generalizes this reasonably, but
  hasn't been stress-tested against, say, a 3-way interaction display.

None of this changes the Phase 0-3 plan (Axis/Grid/Scatter/Fit/
ConfidenceRibbon/ObservedStat/marker-layout are needed regardless of endpoint
type), but it's exactly the kind of thing worth sanity-checking the generic
shapes against *before* they're load-bearing.

### Worked example: Kaplan-Meier survival, split by exposure tertile

A real example (KM curves split by AUC/Cmax tertile, faceted by exposure
metric, with a number-at-risk table, censoring ticks, per-group median-
event-time boxes, and a CI band) confirms the vocabulary holds up, with one
concrete refinement:

- **Curves are step functions, not smooth lines.** This doesn't change
  `CurveSample`'s shape at all (still `exposure`/`estimate`/`lower`/`upper` -
  "time" instead of "exposure" is just a label, not a structural change).
  It changes *how* `Fit`/`ConfidenceRibbon` interpolate between points.
  Conclusion: give both a pluggable `CurveStyle` (`SmoothStyle` |
  `StepStyle`), the same "shared data, swappable draw strategy" pattern
  `Distribution` already uses for Boxplot/Violin/Lineranges - this should be
  designed into `Fit`/`ConfidenceRibbon` from Phase 2, not bolted on later.
- **Censoring ticks and per-group "Median Event Time" boxes** are both
  already-generalized cases of the marker system (§5/§6): a censoring tick is
  a marker with no label; a median-event-time box is the same
  center/CI-style marker as `ObservedStat`, just anchored to a fixed
  corner/edge instead of a specific x-position. Neither needs a new
  mechanism - at most a placement-strategy option on an existing marker.
- **The number-at-risk table is not a Layer, and doesn't need to be.** It's a
  separate tabular panel stacked below the plot, sharing the same x-scale -
  structurally identical to a pattern this codebase already has today: the
  "exposure distribution by dose" boxplot strip stacked below the scatter
  panel, sharing its x-axis. No new renderer concept required; it's "compose
  two renderable things that agree on `xDomain`," same as today.

Kaplan-Meier/Cox support itself (an `AnalysisModel` plugin, per ADR-0008) is
not part of this migration's scope - no such plugin exists yet. This is
purely a vocabulary stress-test, done now because it's cheap to fix before
Phase 1/2 and expensive after.

### Worked example: multi-panel quartile split with a reference arm

A second real example (six panels - AUC/Cmin/Cmax at two dosing timepoints -
each showing Q1-Q4 exposure-quartile survival curves plus a fixed "SoC"
(Standard of Care/control) reference curve) validates three more points,
each already true of the design rather than requiring a change:

- **A reference/control arm (placebo, SoC) is just another `Fit` layer
  instance, not a special renderer concept.** This codebase already treats
  Placebo this way at the data-preparation layer today (excluded from
  quantile-split bins, shown as its own always-present row) - SoC here is
  the identical pattern applied to a survival curve. The renderer doesn't
  need to know a curve is "the control arm" versus "an exposure quartile";
  that meaning lives entirely in how the caller prepares and colors its
  `Fit` instances.
- **Grouping/stratification must stay fully caller-defined - confirmed by
  "we might want to split by risk factor like age or sex."** The renderer's
  multi-curve overlay (color+style per `Fit` instance) already makes no
  assumption about what a "group" is (dose, exposure quartile, sex, age
  band, SoC vs. treated) - it only knows "here are N curves, each with a
  color." Worth stating explicitly as a constraint to preserve: nothing in
  `Fit`/`ObservedStat` should ever special-case "this is an exposure group."
- **Six-panel faceting is the same "one Renderer output per facet" pattern
  as today's two-panel AUC/Cmax columns, just wider.** No new concept -
  confirms the existing per-metric-column composition scales past 2-3
  panels without needing anything new from the renderer itself.

### Worked example: two-way facet (sex x split variable), risk table grouped to match the curves

A third example (Female/Male rows x age/AUC/Cmax columns, each panel
tertile-split on *that column's own* variable) sharpens one point left too
loose above: the number-at-risk table isn't merely "a panel that shares the
plot's x-scale" - its rows are grouped and color-matched **identically to
the curves above it** (one n.event/n.risk row-pair per tertile, in that
tertile's own color), and the example's fuller row set
(`n.risk, pct.risk, n.event, cum.n.event, n.censor`) shows the row set
itself needs to be an open list of named per-group, per-time-bin summaries,
not a fixed pair. Conclusion (for whenever this is actually built, not now):
whatever descriptor the caller uses to construct each `Fit` instance
(group id, color, label) needs to be the *same* descriptor a future risk-
table component keys its rows on - "shares xDomain" was necessary but not
sufficient; "shares the group/color list" is the fuller requirement. Noted
for later - KM/risk-table support stays out of scope for the current
7-phase migration until there's an actual survival-model plugin to drive it.

### Worked example: arbitrary/multiple grouping variables - and a live bug this design must not repeat

The user's own R function (`ggresponseexpdist`) already supports an
additional risk-factor split beyond dose/exposure-metric/endpoint -
`mean_obs_byexptile_group = "SEX"` - faceting `Endpoint x SEX x expname`. It
has a live, acknowledged bug: the response-curve/mean-by-exposure-tile
computation correctly splits by SEX, but the distribution (boxplot) panel
does not - it's computed once and shared across the SEX facets instead of
independently per facet. This isn't SEX-specific: the same gap would appear
for STUDY, race, renal-function category, or any other covariate in the
source data, including more than one such variable at once (e.g. SEX x
STUDY).

Root cause, and why the redesign must not reproduce it: in the current
monolith, dose/exposure-metric/endpoint are hard-coded, named facet
dimensions threaded positionally through the stat-computation code. Adding a
grouping dimension means finding *every* place that iterates "by dose" and
remembering to also iterate "by dose x sex" - miss one, and you get exactly
this bug (curve split correctly, distribution silently pooled).

Proposed fix, entirely at the computation layer (not the renderer, which
only ever receives arrays and doesn't know what produced them):

- Replace the fixed positional `(dose, exposureMetric, endpoint)` tuple
  with a generic, open key: `type GroupKey = Record<string, string | number>`
  - e.g. `{ dose: "2400 mg", exposureMetric: "AUC", endpoint: "ICGI", sex: "F" }`.
  Any number of dimensions, any names, caller-defined - no dimension is
  privileged or hard-coded.
- One shared enumeration of `GroupKey[]` (full cartesian product, or a
  caller-supplied subset - e.g. excluding SoC/placebo from quantile splits,
  per the earlier reference-arm example) drives *every* per-group
  computation that eventually feeds the renderer: `ObservedStatBin`
  construction, Distribution's per-group bins (boxplot/violin/lineranges all
  group identically), and curve/projection construction.
- Concretely, this means one computation entry point takes the full
  `GroupKey[]` and produces one bin/curve per key for each output type -
  making it structurally impossible for the curve to be grouped one way and
  the distribution to be grouped a coarser way by omission, because both
  are required to draw from the same shared enumeration rather than each
  independently deciding which dimensions to honor.

This is entirely a `packages/analysis`/caller-side fix - it changes nothing
about the renderer's Phase 0-3 plan (`ObservedStatBin[]`/Distribution bins
are still just arrays as far as any Layer is concerned), but it does mean
Phase 6's Distribution-layer work, and whatever eventually builds the
stat-computation helpers feeding `ObservedStat`/`Distribution`, should be
built against `GroupKey` from the start rather than a fixed dose/endpoint
tuple - so a future SEX/STUDY/whatever split is "pass a richer `GroupKey[]`"
rather than "hunt down every hard-coded grouping loop," which is the exact
class of bug being fixed here.

If there are further approved-drug examples (ordinal scales, count/rate
endpoints, multi-covariate displays) worth checking the proposed shapes
against, that would keep sharpening `CurveSample`/`ObservedStatBin`/the
`Distribution`/`Fit` strategy interfaces - happy to work through more.

## 8. Migration plan

New package alongside the existing one, not an in-place rewrite - mirrors how
ADR-0007/0008 kept `legacyStatistics.ts` fully working while
`AnalysisModel`/`model-linear` were built and adopted incrementally, deleting
the old path only once nothing depended on it. `apps/demo` has exactly 4 call
sites into the current renderer (2x `renderLogisticScatterChart`, 1x
`renderLinearScatterChart`, 1x `renderDistributionChart`), so a rewrite-in-
place risks a real window where the one consuming app doesn't build.

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold `packages/renderer` (package.json/tsconfig/workspace wiring), depends only on `domain` | **Done.** |
| 1 | `Scale`, `DrawContext`/collectors, `SVGRenderer`, `Axis`/`Grid`/`Scatter` layers | **Done.** |
| 2 | `Fit`/`ConfidenceRibbon` layers, `CurveSample` alias, `sampleCurve()` in `analysis` | **Done.** |
| 3 | `ObservedStat` layer, marker-layout port, `Annotation`/reference-lines on the shared collector | **Done.** |
| 4 | First real cutover: the **linear** scatter chart call site (simpler - dynamic y-domain, no fixed probability range) | **Done.** |
| 5 | Logistic scatter chart (2 call sites incl. Compare Endpoints), dose-click-projection decomposition | **Done.** Interaction stayed DOM-query-based in `apps/demo` (the `FillStyle.attrs`/native `<title>` stopgap) rather than a formal `InteractionController` - no second consumer has yet shown up to justify promoting it. |
| 6 | `Distribution` layer + 3 shape strategies; fix KDE-at-render-time by moving density computation upstream | **Done.** |
| 7 | Delete `packages/visualization-engine` | **Done.** Demo's `fitFor`/`curveFor` legacy-shape adapter (`PredictionResult`/`toCurveSamples`) was deliberately kept - it bridges the legacy logistic fitter (`legacyStatistics.ts`, out of scope for this migration) to `CurveSample`, not a `packages/visualization-engine` leftover. |

Notes: `CanvasRenderer` stays a placeholder; scope creep there was explicitly
out of bounds for this migration. Phase 7 did **not** touch
`legacyStatistics.ts`'s hand-rolled logistic fitter - that's the separate,
already-tracked model-plugin migration (ADR-0007/8), not this one.

## 9. Draft ADR-0009 (to add to `docs/DECISIONS.md` once agreed)

> ADR-0009 `packages/visualization-engine` is renamed `packages/renderer`.
> Renderer/Layer/SVGRenderer separate rendering from statistics and from
> interaction. A `Renderer` composes an ordered list of `Layer` instances
> (Axis, Grid, Scatter, Fit, ConfidenceRibbon, ObservedStat, Distribution,
> Annotation) against a shared draw context. `SVGRenderer` is the concrete
> implementation of ADR-0003's SVG target; `CanvasRenderer` is an
> intentionally unimplemented placeholder for a future non-SVG target, out
> of scope for this migration.
>
> Layers consume plain domain vocabulary, not analysis-layer contracts:
> `CurveSample` is an alias of `packages/domain`'s `PredictionPoint`, the
> same shape already used by persisted `Prediction.points` (ADR-0004), so a
> live-sampled curve and a session-replayed curve render through one path.
> `packages/renderer` depends only on `@er-explorer/domain` - never
> `@er-explorer/analysis`, `@er-explorer/data`, or React. Reconciling a live
> `AnalysisModel`'s `PredictionSurface` + `ConfidenceInterval[]` into a
> `CurveSample[]` is not the renderer's job - it's either the calling
> application's responsibility or a small non-computational helper
> (`sampleCurve`) in `packages/analysis`, which already owns both source
> types.
>
> Interaction is not a Layer. Layers may optionally register inert markers
> and hit-regions into the draw context while rendering; the Renderer
> resolves marker layout once, across every layer, after all layers have
> run. Turning hit-regions into live pointer/keyboard behavior is the job of
> a separate `InteractionController`, not part of core Renderer/Layer, and
> not required to live in `packages/renderer` - it starts in `apps/demo` and
> is only promoted into the renderer package if a second consumer proves the
> shape general rather than DOM-specific.
>
> `packages/renderer` performs no statistical computation, including
> density estimation for Distribution's violin shape: KDE/bandwidth
> selection happens upstream of layer construction; `DistributionLayer`'s
> violin strategy consumes pre-computed density samples, never invokes
> analysis functions itself.
>
> Migration follows the ADR-0007/0008 precedent: `packages/renderer` is
> built and proven in isolation, `apps/demo`'s four call sites are cut over
> one at a time with `packages/visualization-engine` kept working
> throughout, and the old package is deleted only once every call site has
> moved.

## 10. Decisions

- **Interaction**: not a Layer. Layers emit inert hit-regions/markers into a
  shared context; a separate `InteractionController`, starting in
  `apps/demo`, does real event wiring. **Confirmed.**
- **Migration approach**: new `packages/renderer` built alongside the
  existing package, `apps/demo`'s call sites cut over one at a time,
  `packages/visualization-engine` deleted last. **Confirmed.**
- **Fit vs. ConfidenceRibbon split**: two separately-instantiable layers, so
  a caller can show a fit line without its band, and so two different CI
  methods (Wald vs. bootstrap) can be compared as two ConfidenceRibbon
  layers over one Fit layer. **Confirmed** - directly requested (only want
  the line sometimes; more than one way to compute a CI).
- **Renderer's dependency**: `@er-explorer/domain` only, via
  `CurveSample = PredictionPoint`, with a `sampleCurve()` merge helper in
  `packages/analysis`. **Confirmed** (explicitly re-checked after an
  initial conflicting answer).
- **Layer ordering grammar**: resolved by design (§6) - a fixed per-kind
  rank table owned by the `Renderer`, not the caller, with array position
  only as a same-rank tiebreak. No outstanding user input needed here.
- **Grouping/faceting variables**: generalized as an open `GroupKey`
  (`Record<string, string | number>`), not a hard-coded dose/exposure-
  metric/endpoint tuple (§7, "arbitrary/multiple grouping variables").
  Every per-group computation feeding the renderer (`ObservedStatBin`,
  Distribution bins, curves) must be driven from one shared `GroupKey[]`
  enumeration, so adding a new split (SEX, STUDY, or more than one at once)
  can never silently miss a downstream computation the way the current R
  function's distribution panel does today. **Confirmed** - directly
  motivated by a real, currently-open bug in the user's own code.

## 11. Still open

1. **Endpoint-type examples**: an open invitation, not a blocker - if
   there are specific approved-drug examples (survival/time-to-event,
   ordinal, count/rate, multi-covariate) worth checking `CurveSample`/
   `ObservedStatBin`/the `Distribution` strategy shapes against before
   Phase 1 locks them in, they'd sharpen the generic vocabulary. Not
   blocking Phase 0 - can revisit before Phase 1 if useful.

All architectural decisions needed to start Phase 0 are now confirmed.
