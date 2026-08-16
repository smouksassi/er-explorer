import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "@er-explorer/domain";
import { loadDataset } from "./loadedDataset";
import { enumerateScatterPanels } from "./viewLayoutEnumerate";
import { createCellResolver, resolveCellContexts } from "./cellResolution";

function wide(rows: Record<string, (string | number)[]>): ReturnType<typeof loadDataset> {
  return loadDataset(new Map(Object.entries(rows)));
}

const loaded = wide({
  id: [1, 2, 3, 4, 5, 6, 7, 8],
  sex: ["F", "M", "F", "M", "F", "M", "F", "M"],
  wt: [50, 60, 70, 80, 90, 100, 110, 120],
  dose: ["Pbo", "600", "Pbo", "600", "1200", "1200", "600", "1200"],
  auc: [0, 100, 0, 120, 200, 210, 90, 220],
  icgi: [0, 1, 1, 0, 1, 1, 0, 1]
});
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const input = { xMetricIds: ["auc"], endpointIds: ["icgi"] };

const baseSpec: ViewLayoutSpec = {
  mode: "advanced",
  rowDimensions: [],
  colDimensions: [{ kind: "xMetrics", ids: ["auc"], order: ["auc"] }],
  color: { kind: "dose" },
  fitByColor: false,
  distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
};

describe("createCellResolver", () => {
  it("categorical color variable: levels from data, per-level rows", () => {
    const spec: ViewLayoutSpec = {
      ...baseSpec,
      color: { kind: "variable", variableId: "sex" },
      fitByColor: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const panels = enumerateScatterPanels(loaded, [], spec, input);
    const [ctx] = resolveCellContexts(loaded, spec, ["icgi"], ALL, panels);
    expect(ctx!.colorChannel).toEqual({ kind: "variable", variableId: "sex", levels: ["F", "M"] });
    expect(ctx!.curveGroups.map((g) => g.level)).toEqual(["F", "M"]);
    expect(ctx!.curveGroups[0]!.rows).toEqual([0, 2, 4, 6]);
    expect(ctx!.curveGroups[1]!.rows).toEqual([1, 3, 5, 7]);
    expect(ctx!.distRows).toEqual({ splitLevels: ["F", "M"], palette: "variable", variableId: "sex" });
  });

  it("numeric covariate bins once on the BASE cohort, not per panel", () => {
    const spec: ViewLayoutSpec = {
      ...baseSpec,
      // wt has 8 distinct values over threshold? (threshold 15 distinct) — force binning via spec
      color: { kind: "variable", variableId: "wt", binning: "median" },
      continuousBinning: "median",
      rowDimensions: [{ kind: "variable", variableId: "sex" }],
      fitByColor: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const resolver = createCellResolver(loaded, spec, ["icgi"], ALL);
    // wt is not numeric-continuous by threshold (8 distinct < 15) → categorical levels.
    // The invariant under test: the SAME level model serves every panel.
    const panels = enumerateScatterPanels(loaded, [], spec, input);
    const contexts = panels.map((p) => resolver.resolve(p));
    for (const ctx of contexts) {
      for (const g of ctx.observedGroups) {
        expect(resolver.colorLevels).toContain(g.level);
      }
    }
  });

  it("degenerate facet+color (sex on both): each panel keeps its single level color", () => {
    const spec: ViewLayoutSpec = {
      ...baseSpec,
      rowDimensions: [{ kind: "variable", variableId: "sex" }],
      color: { kind: "variable", variableId: "sex" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const panels = enumerateScatterPanels(loaded, [], spec, input);
    expect(panels).toHaveLength(2);
    const contexts = resolveCellContexts(loaded, spec, ["icgi"], ALL, panels);
    const fPanel = contexts.find((c) => c.panelId.includes("sex=F"))!;
    const mPanel = contexts.find((c) => c.panelId.includes("sex=M"))!;
    expect(fPanel.colorChannel).toEqual({ kind: "variable", variableId: "sex", levels: ["F"] });
    expect(fPanel.curveGroups[0]!.colorKey).toBe("F");
    expect(mPanel.curveGroups[0]!.colorKey).toBe("M");
    // Facet cohorts must differ (this was the identical-panels bug class).
    expect(fPanel.facetCohort).not.toEqual(mPanel.facetCohort);
    expect(fPanel.facetCohort).toEqual([0, 2, 4, 6]);
  });

  it("color = endpoints: neutral dist rows in every cell", () => {
    const spec: ViewLayoutSpec = {
      ...baseSpec,
      mode: "guided",
      color: { kind: "endpoints" },
      endpointOverlay: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
    const panels = enumerateScatterPanels(loaded, [], spec, {
      xMetricIds: ["auc"],
      endpointIds: ["icgi", "icgi2"]
    });
    const contexts = resolveCellContexts(loaded, spec, ["icgi", "icgi2"], ALL, panels);
    for (const ctx of contexts) {
      expect(ctx.distRows.palette).toBe("neutral");
      expect(ctx.curveGroups.map((g) => g.colorKey)).toEqual(ctx.endpointIds);
    }
  });

  it("color = dose: dose palette, pooled curve", () => {
    const panels = enumerateScatterPanels(loaded, [], baseSpec, input);
    const [ctx] = resolveCellContexts(loaded, baseSpec, ["icgi"], ALL, panels);
    expect(ctx!.distRows).toEqual({ splitLevels: [], palette: "dose" });
    expect(ctx!.curveGroups).toHaveLength(1);
  });
});
