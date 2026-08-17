import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "./viewLayout";
import { resolveCellContext, type CellResolutionInput } from "./cellContext";
import { ensureScaleBearingFacets } from "./viewLayout";
import {
  emptyViewSelection,
  formatDistGroupId,
  parseDistGroupId,
  selectedDoseUniverse,
  toggleDistGroup,
  toggleDose
} from "./viewSelection";

const base: ViewLayoutSpec = {
  mode: "advanced",
  rowDimensions: [],
  colDimensions: [{ kind: "xMetrics", ids: ["auc"], order: ["auc"] }],
  color: { kind: "dose" },
  fitByColor: false,
  distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
};

/** rows 0..9; even rows sex=1, odd rows sex=2; row 9 missing sex. */
const sexOf = (_: string, i: number): string | null => (i === 9 ? null : i % 2 === 0 ? "1" : "2");
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function input(overrides: Partial<CellResolutionInput> & { spec: ViewLayoutSpec }): CellResolutionInput {
  return {
    panel: { id: "p1", facetKey: { xMetric: "auc" }, xVariableId: "auc", endpointId: "icgi", rowIndices: ROWS },
    selectedEndpointIds: ["icgi"],
    ...overrides
  };
}

describe("resolveCellContext — color = dose (default)", () => {
  it("one pooled curve, dose-palette dist rows, metric split scope", () => {
    const ctx = resolveCellContext(input({ spec: base }));
    expect(ctx.endpointIds).toEqual(["icgi"]);
    expect(ctx.curveGroups).toHaveLength(1);
    expect(ctx.curveGroups[0]!.rows).toEqual(ROWS);
    expect(ctx.distRows).toEqual({ splitLevels: [], palette: "dose" });
    expect(ctx.splitCohortScope).toBe("metricPopulation");
    expect(ctx.xDomainKey).toBe("auc");
  });

  it("fitByColor with dose → one curve per arm (dose is not special)", () => {
    const doseOf = (i: number): string | null => (i < 4 ? "Placebo" : i < 7 ? "600 mg" : "1200 mg");
    const ctx = resolveCellContext(
      input({
        spec: { ...base, fitByColor: true },
        doseLevels: ["Placebo", "600 mg", "1200 mg"],
        doseForRow: doseOf
      })
    );
    expect(ctx.curveGroups.map((g) => g.level)).toEqual(["Placebo", "600 mg", "1200 mg"]);
    expect(ctx.curveGroups[1]!.rows).toEqual([4, 5, 6]);
    expect(ctx.curveGroups[1]!.colorKey).toBe("600 mg");
    expect(ctx.distRows).toEqual({ splitLevels: [], palette: "dose" });
  });
});

describe("resolveCellContext — color = endpoints", () => {
  const spec: ViewLayoutSpec = { ...base, color: { kind: "endpoints" } };

  it("overlay cell: one curve group per endpoint, NEUTRAL dist rows (one color channel)", () => {
    const ctx = resolveCellContext(
      input({
        spec,
        panel: {
          id: "p1",
          facetKey: { xMetric: "auc" },
          xVariableId: "auc",
          endpointId: "icgi",
          endpointIds: ["icgi", "icgi2"],
          rowIndices: ROWS
        },
        selectedEndpointIds: ["icgi", "icgi2"]
      })
    );
    expect(ctx.endpointIds).toEqual(["icgi", "icgi2"]);
    expect(ctx.curveGroups.map((g) => g.colorKey)).toEqual(["icgi", "icgi2"]);
    expect(ctx.curveGroups.every((g) => g.rows === ctx.curveGroups[0]!.rows || g.rows.length === ROWS.length)).toBe(true);
    expect(ctx.distRows.palette).toBe("neutral");
    expect(ctx.distRows.splitLevels).toEqual([]);
  });

  it("endpoint-faceted cell: single endpoint curve keyed to its endpoint color, dist still neutral", () => {
    const faceted: ViewLayoutSpec = {
      ...spec,
      rowDimensions: [{ kind: "endpoints", ids: ["icgi", "icgi2"], order: ["icgi", "icgi2"] }]
    };
    const ctx = resolveCellContext(
      input({
        spec: faceted,
        panel: {
          id: "p-icgi2",
          facetKey: { xMetric: "auc", endpoint: "icgi2" },
          xVariableId: "auc",
          endpointId: "icgi2",
          rowIndices: ROWS
        },
        selectedEndpointIds: ["icgi", "icgi2"]
      })
    );
    expect(ctx.endpointIds).toEqual(["icgi2"]);
    expect(ctx.curveGroups).toEqual([{ endpointId: "icgi2", rows: ROWS, colorKey: "icgi2" }]);
    // ADR-0012 one-channel rule: the strip describes exposure — never endpoint-tinted.
    expect(ctx.distRows.palette).toBe("neutral");
  });
});

describe("resolveCellContext — color = variable (sex)", () => {
  const spec: ViewLayoutSpec = {
    ...base,
    color: { kind: "variable", variableId: "sex" },
    distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
  };
  const vars = { colorLevels: ["1", "2"], levelForRow: sexOf };

  it("observed groups per level; missing-level rows stay in cohort but join no group", () => {
    const ctx = resolveCellContext(input({ spec, ...vars }));
    expect(ctx.facetCohort).toEqual(ROWS);
    expect(ctx.observedGroups.map((g) => g.level)).toEqual(["1", "2"]);
    const grouped = ctx.observedGroups.flatMap((g) => g.rows);
    expect(grouped).not.toContain(9);
    expect(grouped).toHaveLength(9);
  });

  it("fitByColor off → one pooled curve over the full cohort", () => {
    const ctx = resolveCellContext(input({ spec, ...vars }));
    expect(ctx.curveGroups).toHaveLength(1);
    expect(ctx.curveGroups[0]!.rows).toEqual(ROWS);
    expect(ctx.curveGroups[0]!.level).toBeUndefined();
  });

  it("fitByColor on → one curve per level with that level's rows (every model family)", () => {
    const ctx = resolveCellContext(input({ spec: { ...spec, fitByColor: true }, ...vars }));
    expect(ctx.curveGroups.map((g) => g.level)).toEqual(["1", "2"]);
    expect(ctx.curveGroups[0]!.rows).toEqual([0, 2, 4, 6, 8]);
    expect(ctx.curveGroups[1]!.rows).toEqual([1, 3, 5, 7]);
  });

  it("colorDistShapes on → dist rows split by present levels with variable palette", () => {
    const ctx = resolveCellContext(input({ spec, ...vars }));
    expect(ctx.distRows).toEqual({ splitLevels: ["1", "2"], palette: "variable", variableId: "sex" });
  });

  it("colorDistShapes OFF → unsplit rows are NEUTRAL, never dose colors (one channel)", () => {
    const ctx = resolveCellContext(
      input({ spec: { ...spec, distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false } }, ...vars })
    );
    expect(ctx.distRows).toEqual({ splitLevels: [], palette: "neutral" });
  });

  it("overlay endpoints × fitByColor → cartesian curve groups (endpoint × level)", () => {
    const ctx = resolveCellContext(
      input({
        spec: { ...spec, fitByColor: true },
        panel: {
          id: "p1",
          facetKey: { xMetric: "auc" },
          xVariableId: "auc",
          endpointId: "icgi",
          endpointIds: ["icgi", "icgi2"],
          rowIndices: ROWS
        },
        selectedEndpointIds: ["icgi", "icgi2"],
        ...vars
      })
    );
    expect(ctx.curveGroups.map((g) => `${g.endpointId}:${g.level}`)).toEqual([
      "icgi:1",
      "icgi:2",
      "icgi2:1",
      "icgi2:2"
    ]);
  });
});

describe("resolveCellContext — degenerate facet+color on the same variable (ADR-0012 legal)", () => {
  it("single-level panel keeps that level's color identity everywhere", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      rowDimensions: [{ kind: "variable", variableId: "sex" }],
      color: { kind: "variable", variableId: "sex" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    // Panel for sex=2: cohort already sliced by the facet.
    const rows = [1, 3, 5, 7];
    const ctx = resolveCellContext(
      input({
        spec,
        panel: { id: "p-sex2", facetKey: { xMetric: "auc", sex: "2" }, xVariableId: "auc", endpointId: "icgi", rowIndices: rows },
        colorLevels: ["1", "2"],
        levelForRow: sexOf
      })
    );
    // Only level "2" is present — encoding stays that level's color (stable across facet toggles).
    expect(ctx.colorChannel).toEqual({ kind: "variable", variableId: "sex", levels: ["2"] });
    expect(ctx.curveGroups).toHaveLength(1);
    expect(ctx.curveGroups[0]!.colorKey).toBe("2");
    // Single level → no redundant sub-row split, but the row still wears the level color.
    expect(ctx.distRows).toEqual({ splitLevels: [], palette: "variable", variableId: "sex" });
  });
});

describe("viewSelection — serializable dist selection", () => {
  it("formats and parses dose|endpoint vs dose|level via known endpoint ids", () => {
    expect(formatDistGroupId({ dose: "600 mg" })).toBe("600 mg");
    expect(formatDistGroupId({ dose: "600 mg", endpointId: "icgi" })).toBe("600 mg|icgi");
    expect(formatDistGroupId({ dose: "600 mg", level: "2" })).toBe("600 mg|2");
    expect(parseDistGroupId("600 mg", ["icgi"])).toEqual({ dose: "600 mg" });
    expect(parseDistGroupId("600 mg|icgi", ["icgi"])).toEqual({ dose: "600 mg", endpointId: "icgi" });
    expect(parseDistGroupId("600 mg|2", ["icgi"])).toEqual({ dose: "600 mg", level: "2" });
  });

  it("round-trips through format/parse", () => {
    const refs = [
      { dose: "Placebo" },
      { dose: "1200 mg", endpointId: "brls" },
      { dose: "1200 mg", level: "1" }
    ];
    for (const ref of refs) {
      expect(parseDistGroupId(formatDistGroupId(ref), ["brls", "icgi"])).toEqual(ref);
    }
  });

  it("toggles rows and doses; dose universe unions both", () => {
    let sel = emptyViewSelection();
    sel = toggleDose(sel, "600 mg");
    sel = toggleDistGroup(sel, { dose: "1200 mg", level: "2" });
    expect(selectedDoseUniverse(sel).sort()).toEqual(["1200 mg", "600 mg"]);
    sel = toggleDistGroup(sel, { dose: "1200 mg", level: "2" });
    expect(sel.selectedDistGroups).toEqual([]);
    sel = toggleDose(sel, "600 mg");
    expect(selectedDoseUniverse(sel)).toEqual([]);
  });

  it("distinguishes equal-dose refs by suffix kind when toggling", () => {
    let sel = emptyViewSelection();
    sel = toggleDistGroup(sel, { dose: "600 mg", level: "icgi-like" });
    sel = toggleDistGroup(sel, { dose: "600 mg", endpointId: "icgi-like" });
    expect(sel.selectedDistGroups).toHaveLength(2);
  });
});

describe("ensureScaleBearingFacets — ADR-0012 scale-bearing rule", () => {
  it("implicitly facets >1 metric onto columns instead of dropping levels", () => {
    const spec = ensureScaleBearingFacets(base, ["auc", "cmax"], ["icgi"]);
    expect(spec.colDimensions.some((d) => d.kind === "xMetrics")).toBe(true);
  });

  it("implicitly facets >1 endpoint onto rows when not overlaid by color=endpoints", () => {
    const noFacets: ViewLayoutSpec = { ...base, colDimensions: [] };
    const spec = ensureScaleBearingFacets(noFacets, ["auc"], ["icgi", "icgi2"]);
    expect(spec.rowDimensions.some((d) => d.kind === "endpoints")).toBe(true);
  });

  it("leaves color=endpoints overlay alone (legal same-scale overlay)", () => {
    const overlay: ViewLayoutSpec = { ...base, colDimensions: [], color: { kind: "endpoints" } };
    const spec = ensureScaleBearingFacets(overlay, ["auc"], ["icgi", "icgi2"]);
    expect(spec.rowDimensions).toHaveLength(0);
  });

  it("does not add facets when the user already placed them", () => {
    const placed: ViewLayoutSpec = {
      ...base,
      rowDimensions: [{ kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }],
      colDimensions: []
    };
    const spec = ensureScaleBearingFacets(placed, ["auc", "cmax"], ["icgi"]);
    expect(spec.colDimensions).toHaveLength(0);
    expect(spec.rowDimensions).toHaveLength(1);
  });
});

describe("implicit facets stay derived (user can re-place scale-bearing dims)", () => {
  it("authored ROW beats a persisted implicit COLUMN of the same kind", () => {
    const stuck: ViewLayoutSpec = {
      ...base,
      rowDimensions: [{ kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }],
      colDimensions: [{ kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"], implicit: true }]
    };
    const spec = ensureScaleBearingFacets(stuck, ["auc", "cmax"], ["icgi"]);
    expect(spec.colDimensions.some((d) => d.kind === "xMetrics")).toBe(false);
    expect(spec.rowDimensions.some((d) => d.kind === "xMetrics")).toBe(true);
  });

  it("implicit dims are recomputed, not accumulated", () => {
    const noFacets: ViewLayoutSpec = { ...base, colDimensions: [] };
    const withImplicit = ensureScaleBearingFacets(noFacets, ["auc", "cmax"], ["icgi"]);
    const again = ensureScaleBearingFacets(withImplicit, ["auc", "cmax"], ["icgi"]);
    expect(again.colDimensions.filter((d) => d.kind === "xMetrics")).toHaveLength(1);
    expect(again.colDimensions.find((d) => d.kind === "xMetrics")?.implicit).toBe(true);
  });
});
