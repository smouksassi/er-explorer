# ER Explorer — minimal demo

A first working, interactive exposure-response demo built directly on the
three ER Explorer engine packages, to show potential users the shape of the
product.

## What it shows

- A real logistic exposure-response fit (Newton-Raphson IRLS, ridge-stabilized)
  computed by `@er-explorer/statistical-engine`, with a 95% confidence band
  from either a Wald (delta-method) approximation or a seeded, reproducible
  bootstrap.
- Publication-quality SVG rendering from `@er-explorer/visualization-engine`:
  a jittered exposure-response scatter with fitted curve/band, linked to a
  per-dose-group exposure distribution panel.
- Select more than one exposure metric (AUC, CMAX) at once — one scatter +
  distribution panel pair renders per exposure, all sharing one linked
  selection (brushing in any panel highlights the same patients everywhere).
- Select more than one endpoint (ICGI, ICGI2, ICGI3) at once — each adds a
  full row to the exposure-vs-response grid, with exposure metrics as
  columns, mirroring the R `facet_grid(Endpoint ~ expname)` layout. Every
  row shares the same x-axis (exposure) domain per column, so reading down
  a column at a fixed exposure shows exactly how the response rate differs
  across endpoints. The exposure distribution panel below stays one row per
  exposure metric regardless of endpoint count (dose exposure doesn't
  depend on which response endpoint you're looking at); it uses the first
  selected endpoint for its per-dose responder count.
- **Compare endpoints** (optional toggle, only available with exactly one
  exposure metric and 2+ endpoints selected) — switches to a different
  layout, mirroring ggquickeda's endpoint-comparison facet: one panel per
  endpoint plus a final "(all)" panel overlaying every endpoint's fitted
  curve, CI band, and observed-response markers together. In this view
  coloring and line style (solid / dotted / dashed) switch from per-dose to
  per-endpoint, so the same curve stays identifiable once several are
  layered on top of each other in the "(all)" panel; a small legend shows
  each endpoint's color/dash swatch. Raw scatter points are hidden in this
  view to keep the overlay readable. When several endpoints' observed-rate
  markers land at the same exposure position (common, since they're often
  binned on the same split points), the label layout falls back to spacing
  them evenly across the plot's full height rather than letting any run off
  the top or bottom edge.
- Brushing (drag-select a region of a scatter) and clicking a dose-group row
  both filter/project the same underlying fit — no refitting on the raw
  fitted curve, only on what's projected. Clicking a dose row also draws
  that dose's own observed response rate + 95% Wilson CI, in the dose's own
  color (both the percent and n/N text), next to its projected curve
  segment — so "highlight this dose" answers both "where does it sit on
  the fit" and "what was its actual observed rate" at a glance (independent
  of the split-based reference lines below). This can be turned off via the
  "On dose click" toggle if you just want the plain projection.
- All observed-rate markers (split bins and per-dose/per-endpoint alike) are
  laid out together so they never overlap: markers whose pixel positions
  land close together are automatically stacked into a small vertical
  column, each with a thin leader line back to its true point, and the
  whole stack is kept clear of both the plot's top and bottom edges — if a
  cluster is too tall to fit even after that (e.g. several endpoints
  overlaid at once, each contributing its own marker near the same split
  point), labels are spread evenly across the available height instead of
  running off-canvas. It's a small dependency-free stand-in for a proper
  label-repel/force layout — deliberately not pulling in D3 or a similar
  library just for this, consistent with the rest of the renderer.
- Toggle the distribution panel between a traditional boxplot (box at
  Q1-Q3, thin whisker line to the 1.5*IQR bound, end-cap ticks, median
  line) and a violin/density representation. Both are rendered as the same
  primitive (a mirrored "ridge" polygon sampled at shared x-points), so
  toggling smoothly morphs one shape into the other over ~500ms rather than
  swapping components — no D3 dependency, just a per-frame numeric
  interpolation between two precomputed keyframes. Placebo's exposure is a
  constant zero by design, so its row skips the box/violin shape (which
  would just be a degenerate spike) but still shows its label and patient
  count (N), consistent with every other dose row.
- A single, mutually-exclusive reference-line split (median / tertiles /
  quartiles — pick one, mirroring the R `exposure_metric_split` parameter),
  computed on all dosed patients excluding placebo, drawn as dashed cut
  lines on both the scatter and distribution panels for the active exposure
  metric(s). In the distribution panel the cut line's actual value (e.g.
  "63.1") is also printed at the bottom, in a color distinct from the muted
  grey x-axis ticks, so it's clear that's the reference line's value, not
  another axis label. Two optional add-ons, off by default:
  - **Group N** (Off / N / N (%)) — each dose row in the distribution panel
    shows a plain text label above the shape for how many of its *own*
    patients fall in each split bin, either as a bare count ("16") or count
    + share of that dose group ("16 (7%)").
  - **Observed % responders** — the scatter panel gets a dark marker + 95%
    Wilson-score CI at the raw (non-model) response rate within each split
    bin (placebo forms its own bin at zero exposure), so the observed
    step-wise rate can be compared directly against the smooth fitted
    curve — mirrors ggquickeda's "Observed probability by exposure split"
    annotation. Since the marker sits in the same space as the scatter
    points and can otherwise get lost in a dense cluster, it's drawn with a
    white halo/backdrop so it stays legible without moving it off its true
    (data-accurate) position.
- Session save/load via `@er-explorer/session-engine`: exposure metric(s),
  endpoint(s), CI method, bootstrap seed, distribution mode, reference-line
  selection, and current selection are captured in a small JSON session
  file (`docs/REPRODUCIBILITY.md`) that can be reloaded to reproduce the
  exact view.

The bundled dataset (`data/effICGI.csv`) is an example exposure-response
dataset (AUC/CMAX vs. ICGI-derived binary clinical response, across 3
pooled studies and 5 dose groups) provided for demo purposes.

## Build and run

From the repo root:

```
pnpm install
pnpm build
```

This regenerates `apps/demo/src/data.generated.ts` from the CSV and produces
a single self-contained file at `apps/demo/dist/index.html` — open it
directly in a browser, no server required.

## Notes

- `dist/` and `src/data.generated.ts` are build outputs (gitignored) —
  regenerate them with `pnpm build` rather than editing by hand.
- The demo intentionally keeps the overall fit fixed and only re-renders
  projections/selections on brush or dose-click, matching how the reference
  interactive dashboard this was modeled on behaves.
