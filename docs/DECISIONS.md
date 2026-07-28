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
