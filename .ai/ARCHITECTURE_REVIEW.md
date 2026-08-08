# Architectural review (stabilization phase)

**Date:** 2026-08-07  
**Status:** Approved for planning; **no bulk implementation** until slice-by-slice approval.  
**Phase:** Architecture stabilization — reduce coupling, clarify domain, prepare for future model families.

---

## 1. Architecture summary

**Pipeline:** Wide `StudyDataset` (immutable) → lazy views (`@er-explorer/data`) → `Question` / `AnalysisSpec` → `@er-explorer/analysis` + plugins → `Prediction` / sampled curves → `@er-explorer/renderer` → demo UI.

**Maturity:** Foundation and demo are **real** (logistic + linear, bootstrap, linked scatter/dist, BYOD, partial session save, Advanced layout spec). Not yet a full analysis workbench: demo still **plot-centric**, fits often invoked from `main.ts`, layout/selection not fully in session.

**Documented vs actual:**

- No separate `packages/ui` (React)—all UI in `apps/demo` (vanilla TS).
- `ViewLayoutSpec` and enumeration exist; Guided compare still uses **parallel booleans and mount paths**.
- Roadmap/README slightly stale on CI (workflow exists) and covariate color (partially in Advanced).

---

## 2. Duplicated logic

| Area | Where | Issue |
|------|--------|--------|
| **Scatter paint** | `paintRegularScatterIntoWrap`, `paintCompareScatterIntoWrap`, `renderScatterPanel` | Overlapping fit/curve/projection/point color rules |
| **Compare vs spec** | `guidedViewLayout.ts` + `compareEndpoints` + `isGuidedCompareTopology` | Same topology expressible twice |
| **Dist split** | `compareDistByEndpoint`, `distEndpointColorSplit`, `distPaintContextForStack` | Split behavior not one function of spec |
| **Neutral coloring** | `compareDistUsesNeutralShapes`, `isEndpointComparisonActive`, `doseColorFor` | Gray dist/projections vs colored points |
| **Projections** | `projectedGroupsFor`, `projectedLinearGroupsFor`, compare fit map | Dose filter + color override repeated |
| **X-domain** | `exposureXDomain`, `xDomainForLinkedPanels` | Sync scatter/dist partially centralized |
| **Facet labels** | `columnTitleForPanel`, `rowStripLabelForPanels`, render paths | OK but tied to demo only |
| **Fit entry** | `fitFor`, `fitForCohort`, `tryFitForCohort` | Demo wraps analysis; no panel-level AnalysisSpec |

---

## 3. Package boundary violations

**Mostly respected:**

- `domain` — types only.
- `renderer` — imports `domain` only (verified).
- `analysis` / `model-linear` — plugin direction clear.

**Soft violations / blur:**

| Issue | Severity |
|-------|----------|
| **Layout UX rules in domain** (`isGuidedCompareTopology`, `panelEndpointMode`) | Acceptable if kept pure functions; avoid demo-specific names long-term |
| **Enumeration in data** tied to demo layout knobs | OK location; needs stable domain spec |
| **Statistics in demo** (`main.ts` fit, Wilson, dose stats, KDE for dist) | **Debt** — should move to analysis/data over time |
| **Session settings** ad hoc keys (`compareEndpoints`, layout booleans) alongside partial spec | **Debt** — reproducibility gap |

**No critical hard violation** (renderer doing stats, domain importing React, etc.).

---

## 4. Missing abstractions

| Abstraction | Purpose | Current state |
|-------------|---------|---------------|
| **`PanelVisualEncoding`** (derived from spec + panel) | Colors, dash, split dist, legend | Scattered heuristics in `main.ts` |
| **`SelectionState` (serializable)** | Dose vs `dose\|group` clicks, brush | `Set`s in demo state |
| **`AnalysisJob` / per-panel spec** | Cohort + endpoint + covariates → fit | Global fit per metric/endpoint in demo |
| **`InteractionController`** (ADR-0009) | Hit targets, tooltips | Inline in `main.ts` |
| **`LayoutPreset`** | Guided → spec | Partial via `guidedToViewLayoutSpec` |
| **GroupKey** (documented in RENDERER_ARCHITECTURE) | Shared facet+color keys for stats | Partially duplicated in enumerate vs paint |

---

## 5. Overly coupled components

| Coupling | Risk |
|----------|------|
| **`main.ts` (~4.7k lines)** — state, DOM, fit, paint, session, filters, layout UI | High: any layout fix touches unrelated behavior |
| **DOM `dataset` attributes** (`compareEndpoints`, `stackKind`) as implicit API | Hard to test; easy to desync from spec |
| **Render mount** — overlay branch in `renderViewLayout.ts` vs grid | Two UX paths for same spec family |
| **Legend/readout/status** tied to `isEndpointComparisonActive` | Wrong legend for Advanced encoding |
| **Active patient set** derived from dose selection only partially aware of dist group ids | Selection/evidence mismatch |

**Target coupling:** demo composes **spec → panels → analysis → layer inputs**; no “compare mode” global.

---

## 6. Missing tests

| Layer | Coverage | Gap |
|-------|----------|-----|
| **domain** | Minimal (`index.test.ts`) | Layout helpers, future selection types |
| **data** | Good (filters, views, enumerate) | Variable bin edge cases; linkage collapse phase 2 |
| **analysis** | Some | Plugin registry integration; legacy vs plugin parity |
| **renderer** | Strong layer tests | — |
| **session-engine** | sessionFile tests | Layout spec round-trip |
| **demo** | **None automated** | Paint/mount/selection; smoke script only ad hoc |

**Critical gap:** No test that **encoding from spec** produces expected colors/split flags (even as pure functions once extracted).

---

## 7. Documentation gaps

| Gap | Action |
|-----|--------|
| `ARCHITECTURE.md` short; no layout/session detail | Extend with pointer to `ViewLayoutSpec` + `.ai/` |
| ROADMAP vs demo features | Refresh compare/covariate/Advanced status |
| Encoding/selection not in DECISIONS | **ADR draft** when implementing |
| `ADVANCED_LAYOUT.md` vs actual heuristics | Update when neutral-dist removed |
| No contributor “stabilization plan” in repo | **This folder** (`.ai/`) |

---

## 8. Prioritized improvement plan

### Critical (do first; approve per slice)

1. **ADR: Layout encoding + selection model** — Endpoint as grouping; Guided = presets; serializable selection; dist split = f(spec). *Blocks further heuristic sprawl.*
2. **`resolvePanelStyle(spec, panel)`** (demo module, pure functions testable) — Single source for curve color, point colors, dist split, projection accent. **Remove** neutral-dist default when `color.kind === "endpoints"` unless user chooses dose-colored dist.
3. **Converge mount/paint** — Advanced always grid; Guided overlay optional preset only; one scatter cell builder (single vs multi via `endpointIds`).
4. **Selection resolver** — Map `data-group` / spec → dose sets per panel endpoint; readout + projections + `activeSet` use same helper.
5. **Session: persist `ViewLayoutSpec` + selection** — Advanced layout survives reload; document migration from compare booleans.

### Important

6. Extract **`demo/layout/`** or similar from `main.ts` (paint, dist groups, readout)—no behavior change.
7. **Domain tests** for `panelEndpointMode`, dedupe, linkage helpers.
8. **Integrate covariate color/fit** with spec only (`fitByColor`, variable bins)—drop duplicate Guided checks.
9. **Phase 2 dist linkage** (`collapseKeyForLinkage`) — shared-by-x without duplicate study rows (deferred in plan).
10. Refresh **docs/ROADMAP.md**, **SESSION_HANDOFF.md** layout section.

### Nice to have

11. **`LineStyleEncoding`** in spec (endpoint dash).
12. Demo smoke test (Playwright) for load + one layout snapshot.
13. **`packages/ui`** scaffold for future React shell—empty package, no migration yet.
14. Per-panel **`AnalysisSpec`** wiring through analysis plugins (larger arc).
15. Facet UI v2 (ordered chips, live panel count)—UX polish.

---

## 9. Architectural risks (watch list)

- New model families (ordinal, Cox) implemented as **demo branches** instead of plugins + spec.
- Session files that **cannot replay** Advanced layout → trust loss for reproducibility.
- Continued **compare* flags** → permanent dual behavior (gray boxplots, wrong projections).
- Extracting UI to React **without** extracting encoding/resolver first → duplicated logic again.

---

## 10. Recommended first implementation slice (after approval)

1. Write **ADR draft** in `docs/DECISIONS.md` (encoding + selection).  
2. Add **`apps/demo/src/layout/resolvePanelStyle.ts`** + unit tests (no DOM).  
3. Wire **dist split + projection color** through resolver only; verify Guided compare on/off and Advanced endpoint rows + color endpoints.  
4. Update **`docs/ADVANCED_LAYOUT.md`** + `.ai/LAYOUT_AND_ENCODING.md` status.

**Explicitly out of scope for slice 1:** React UI, new model types, deleting all compare booleans (migrate after session).

---

## Related

- [`.ai/LAYOUT_AND_ENCODING.md`](./LAYOUT_AND_ENCODING.md)
- [`.ai/IMPLEMENTATION_RULES.md`](./IMPLEMENTATION_RULES.md)
- [`docs/RENDERER_ARCHITECTURE.md`](../docs/RENDERER_ARCHITECTURE.md) § GroupKey, interaction
