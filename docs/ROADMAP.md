# Roadmap

v0.0.1 Foundation
- Documentation
- Repository structure
- CI/CD
- Session architecture

v0.1
- Logistic regression (done — `@er-explorer/statistical-engine`, Newton-Raphson IRLS, validated against `statsmodels` GLM)
- Wald CI (done)
- Bootstrap CI (done — seeded case-resampling, reproducible from a session's stored seed)
- Linked visualization (done — see `apps/demo`: brushable exposure-response scatter linked to a per-dose exposure boxplot)

- Multiple exposure metrics and multiple endpoints (done — `apps/demo` supports selecting several of each at once: exposure metrics add columns, endpoints add rows to the exposure-vs-response grid; an optional "Compare endpoints" view additionally overlays every selected endpoint's fitted curve on one panel per exposure metric, colored/dashed by endpoint instead of dose, mirroring ggquickeda's endpoint-comparison facet)

In progress / not yet done:
- Session save/load is implemented (`@er-explorer/session-engine`) but only exercised by the demo app, not yet a first-class UI in a full app shell
- CI/CD not yet set up

Next up (requested, not started):
- **Color/fit by an additional grouping variable** (e.g. below/above-median weight, or any other risk-factor covariate) — analogous to today's dose coloring, but as a second, independent grouping dimension. Unlike dose (which is currently a display-only projection over one shared fit), this should support actually *fitting the logistic curve separately per group* — each group gets its own curve + CI band, not just a recolored slice of a single pooled fit. Reference-line split computation also needs to become group-aware: cut points would be computed per grouping-variable level (e.g. separate tertiles for below-median-weight vs above-median-weight patients), not just pooled across everyone. See attached ggquickeda screenshot (colored by below/above-median weight, faceted by AUC/CMAX, with a matching per-group density panel below) for the target shape of this feature.

Future:
- Continuous endpoints
- Emax
- Ordinal
- Kaplan-Meier
- Cox
- Clinical Utility Explorer
