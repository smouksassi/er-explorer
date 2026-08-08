# Overlays, reference splits, and cohort scope (known gap)

**Status:** ADR-0011 + domain `resolveOverlayCohortPolicy`; demo overlay computors wired (2026-08-08). Fitted-at-split readout may still need cohort pass.
**Reported:** 2026-08-07 (after push of `f055ec4` / layout visual policy).  
**User intent:** Rethink **order of operations** when layout combines **facet × color × dist split**; **every layer** should honor the same analysis cohort unless we **explicitly** document an exception.

---

## Symptom (what looks wrong)

Overlays and split-driven UI are **not consistently split- or color-aware** across the stack. Examples from manual QA (screenshots on file):

| Scenario | What user sees | Expected (product intent) |
|----------|----------------|---------------------------|
| **Facet by sex** (two panels, dose-colored scatter) | Reference **Min / Median / Max** vertical lines and **observed %/N callouts** on the fit show **identical values** in sex=1 vs sex=2 panels | Splits and callouts computed on **that panel’s cohort** (facet slice), not global filtered data |
| **Color by sex** (single panel, blue/orange curves) | Some callouts at splits are **black / pooled** (e.g. one label using full N=227) while later splits show **per-sex** colored callouts | Every split marker and observed bin respects **color group** (or documented exception) |
| **Reference split + dist** | Distribution **Group N** / split annotations may align with exposure splits that ignore facet/color | Annotations and readout cohort match **same scope** as scatter points/curves in that cell |
| **Dose-click projections** | Partial fix exists for `dose\|colorLevel` dist rows; **reference-line overlays** and **observed-at-split** paths may still use wider cohort | Projections **and** vertical split overlays share one **cohort resolver** |

Partial work (2026-08-07) improved **dose-click projections** when `selectedDistGroupIds` holds `dose|level` — that does **not** fix reference splits, observed bins at tertiles/median, fitted-at-split, or per-facet duplicate callouts.

---

## Layers affected (inventory for planning)

Treat each as needing an explicit **cohort scope** from `ViewLayoutSpec` + panel + optional color level:

1. **Reference exposure splits** — vertical lines (none / median / tertiles / quartiles); cut points from which row set?
2. **Observed (%/N) at splits** — bins on scatter (`computeObservedResponseBins`, compare observed, continuous mean bins).
3. **Fitted + CI at splits** — evaluation of curve at split x values; same cohort as fit or global?
4. **Split value labels** — numeric x at split shown on chart.
5. **Split annotations on dist** — N / N (%) on distribution rows (`splitAnnotationsForRows`).
6. **Dose projections** — quantiles from dist click → curve (`projectedGroupsForDistSelection` — partial).
7. **Readout strip** — text under dist after click.
8. **Reference-line split annotations on scatter** — annotation mode n / n_pct.

Today many paths call **`dataFilteredRowIndices()`**, **`computeDisplayReferenceLines(metric)`**, or **`fitFor` / `fitForCohort`** with **inconsistent** cohort arguments (panel `rowIndices`, color subgroup, or full filter).

---

## Design principle (user-approved direction)

> When we **split, color, or facet**, **all layers honor the same grouping** unless we **specifically** carve out an exception.

### Default rule

For each **scatter panel cell** (and linked dist cell):

**Analysis cohort** =  
`facet slice` ∩ `data filters` ∩ (if color is active **within** cell) optional `color level` ∩ brush/selection if applicable.

Every overlay listed above should receive **`cohortForPanel(panelId)`** (or a domain helper derived from spec + panel), not ad hoc globals.

### Documented exceptions (candidates — confirm in ADR before coding)

| Overlay / computation | Proposed scope | Rationale |
|----------------------|----------------|-----------|
| **Exposure split cut points** (median/tertiles/quartiles x positions) | Per **endpoint × exposure metric** (× PK reference-arm rule), **not** per sex/race/dose color | Clinical “split exposure scale” is often defined on the ER analysis population for that endpoint and x, even when faceting for display |
| **X-axis domain (linked)** | Per **exposure metric column** (union of facet rows) | Already implemented — keep |
| **Legend / chrome** | Global or spec-driven | UI only |

User quote (paraphrase): split values of exposure may be computed by **endpoint and exposure metric**, not by group or color — but **observed counts and fit callouts at those x** might still need per-facet/per-color cohort once x is fixed. **Separate “where is the line?” from “what is the rate at that line?”** in the design doc / ADR.

---

## Order of operations (to rethink — not implemented)

Proposed pipeline for one paint cycle (conceptual):

```
1. Resolve ViewLayoutSpec + ScatterPanelSpec / DistPanelSpec
2. Resolve panelVisualPolicy (color source, dist split mode)
3. Resolve cohorts:
   a. facetCohort = panel.rowIndices
   b. colorGroups = levels present in facetCohort (if color = variable and not faceted away)
   c. referenceSplitCohort = f(spec, endpointId, xMetric)  // may differ from facetCohort
4. Compute reference line x positions from referenceSplitCohort
5. For each visual layer, bind (cohort, colorGroup?) per policy table
6. Paint scatter, dist, overlays via renderer with shared metadata (xDomain, split xs, group ids)
```

**Open question:** When **color = sex** and **facet = sex**, panel is single-level — color encoding is degenerate; overlays should still use **facet cohort only**. Policy already warns; overlays must not fall back to global.

**Open question:** **Color = sex**, no sex facet — one panel, two colors. Reference x from exception cohort (endpoint×metric) but observed bins **per sex at those x**?

---

## Code hotspots (when implementing — do not change yet)

| Area | File(s) | Notes |
|------|---------|--------|
| Reference lines | `main.ts` — `computeDisplayReferenceLines`, overlay toggles | Likely global filtered indices |
| Observed bins | `computeObservedResponseBins`, `computeCompareObservedBins`, `computeObservedMeanBins` | Compare vs regular paths |
| Fit scope | `fitFor`, `fitForCohort`, `tryFitForCohort`, `fitByColor` | Multi-curve vs single |
| Dist annotations | `splitAnnotationsForRows`, `buildDistributionGroups` | Cohort vs color split rows |
| Renderer | `packages/renderer` — annotation, observed stat, dose projection layers | May assume one cohort per chart |
| Domain (future) | New: `resolveOverlayCohortPolicy(spec, panel, layerKind)` | Extend ADR-0010 or ADR-0011 |

---

## Suggested next steps (planning only)

1. **ADR-0011 draft** — cohort scope table: layer × default cohort × exceptions (endpoint×metric for split **positions** only).
2. **Matrix test cases** — facet sex × color dose; facet sex × color sex (degenerate); color sex only; compare overlay; Advanced mirror grid.
3. **Domain helper** — `resolveAnalysisCohorts(spec, panel)` returning `{ facet, referenceSplit, colorLevels }` without theme colors.
4. **Demo refactor** — thread one `PanelPaintContext` into all overlay computors (after selection model Phase 2).
5. **Visual regression** — extend `ui-smoke.mjs` or snapshot tests: two facet panels must **not** show identical callout strings when cohorts differ.

---

## Related docs

- [`LAYOUT_AND_ENCODING.md`](./LAYOUT_AND_ENCODING.md) — encoding policy (Phase 0+1)
- [`CONTINUE_HERE.md`](./CONTINUE_HERE.md) — session handoff
- [`docs/DECISIONS.md`](../docs/DECISIONS.md) — ADR-0010 (visual encoding); ADR-0011 TBD
