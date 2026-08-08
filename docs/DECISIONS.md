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
