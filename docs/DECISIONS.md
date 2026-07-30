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
