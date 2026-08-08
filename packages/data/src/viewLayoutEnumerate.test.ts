import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "@er-explorer/domain";
import {
  dedupeFacetDimensions,
  distEndpointColorSplit,
  effectiveEndpointOverlay,
  isGuidedCompareTopology,
  layoutHasEndpointFacet,
  panelEndpointMode,
  usesEndpointColorOverlay
} from "@er-explorer/domain";
import { loadDataset } from "./loadedDataset";
import {
  countPanelsForGuidedTopology,
  enumerateDistPanels,
  enumerateScatterPanels
} from "./viewLayoutEnumerate";

function wide(rows: Record<string, (string | number)[]>): ReturnType<typeof loadDataset> {
  return loadDataset(new Map(Object.entries(rows)));
}

describe("viewLayoutEnumerate", () => {
  const loaded = wide({
    id: [1, 2, 3, 4],
    sex: ["F", "M", "F", "M"],
    dose: ["Pbo", "600", "Pbo", "600"],
    auc: [0, 100, 0, 120],
    cmax: [0, 10, 0, 12],
    icgi: [0, 1, 1, 0],
    icgi2: [0, 0, 1, 1]
  });

  const input = { xMetricIds: ["auc", "cmax"], endpointIds: ["icgi", "icgi2"] };

  it("guided endpoint rows × x columns", () => {
    const spec: ViewLayoutSpec = {
      mode: "guided",
      rowDimensions: [{ kind: "endpoints", ids: ["icgi", "icgi2"], order: ["icgi", "icgi2"] }],
      colDimensions: [{ kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }],
      color: { kind: "dose" },
      fitByColor: false,
      distribution: { linkage: "shared_by_x_column", colorDistShapes: false }
    };
    const scatter = enumerateScatterPanels(loaded, [], spec, input);
    expect(scatter).toHaveLength(4);
    const dist = enumerateDistPanels(spec, scatter, "icgi");
    expect(dist).toHaveLength(2);
  });

  it("compare endpoints overlay", () => {
    const spec: ViewLayoutSpec = {
      mode: "guided",
      rowDimensions: [],
      colDimensions: [{ kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }],
      color: { kind: "endpoints" },
      fitByColor: false,
      endpointOverlay: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    expect(isGuidedCompareTopology(spec)).toBe(true);
    const scatter = enumerateScatterPanels(loaded, [], spec, input);
    expect(scatter).toHaveLength(2);
    const dist = enumerateDistPanels(spec, scatter, "icgi", ["icgi", "icgi2"], 2);
    expect(dist).toHaveLength(2);
    expect(dist.every((d) => (d.readoutEndpointIds?.length ?? 0) === 2)).toBe(true);
  });

  it("snapshot-style Endpoint × sex × x on columns", () => {
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [],
      colDimensions: [
        { kind: "endpoints", ids: ["icgi", "icgi2"], order: ["icgi", "icgi2"] },
        { kind: "variable", variableId: "sex", order: ["F", "M"] },
        { kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }
      ],
      color: { kind: "variable", variableId: "sex" },
      fitByColor: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const scatter = enumerateScatterPanels(loaded, [], spec, input);
    expect(scatter).toHaveLength(8);
    const dist = enumerateDistPanels(spec, scatter, "icgi");
    expect(dist).toHaveLength(8);
  });

  it("countPanelsForGuidedTopology matches endpoint-rows shared dist", () => {
    expect(
      countPanelsForGuidedTopology({
        endpointCount: 2,
        xMetricCount: 2,
        compareEndpoints: false,
        exposureRows: false,
        distLinkage: "shared_by_x_column"
      })
    ).toEqual({ scatter: 4, dist: 2 });
  });

  it("endpoint column facet wins over overlay flag (Advanced split, not compare)", () => {
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [],
      colDimensions: [
        { kind: "endpoints", ids: ["icgi", "icgi2"], order: ["icgi", "icgi2"] },
        { kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }
      ],
      color: { kind: "endpoints" },
      fitByColor: false,
      endpointOverlay: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
    expect(layoutHasEndpointFacet(spec)).toBe(true);
    expect(effectiveEndpointOverlay(spec)).toBe(false);
    expect(isGuidedCompareTopology(spec)).toBe(false);
    const scatter = enumerateScatterPanels(loaded, [], spec, input);
    expect(scatter).toHaveLength(4);
    expect(scatter.every((p) => !p.endpointIds || p.endpointIds.length <= 1)).toBe(true);
    const byEp = new Set(scatter.map((p) => p.endpointId));
    expect(byEp).toEqual(new Set(["icgi", "icgi2"]));
    const dist = enumerateDistPanels(spec, scatter, "icgi", ["icgi", "icgi2"], 2);
    expect(dist).toHaveLength(4);
    expect(new Set(dist.map((d) => d.readoutEndpointId))).toEqual(new Set(["icgi", "icgi2"]));
  });

  it("advanced color endpoints cols=x only uses facet grid with multi-curve cells", () => {
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [],
      colDimensions: [{ kind: "xMetrics", ids: ["auc", "cmax"], order: ["auc", "cmax"] }],
      color: { kind: "endpoints" },
      fitByColor: false,
      endpointOverlay: false,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    expect(isGuidedCompareTopology(spec)).toBe(false);
    expect(usesEndpointColorOverlay(spec, 2)).toBe(false);
    expect(distEndpointColorSplit(spec, 2)).toBe(true);
    const scatter = enumerateScatterPanels(loaded, [], spec, input);
    expect(scatter).toHaveLength(2);
    expect(scatter.every((p) => (p.endpointIds?.length ?? 0) === 2)).toBe(true);
    expect(panelEndpointMode(spec, scatter[0]!.facetKey, 2)).toBe("multiColor");
    const dist = enumerateDistPanels(spec, scatter, "icgi", ["icgi", "icgi2"], 2);
    expect(dist).toHaveLength(2);
    expect(dist.every((d) => (d.readoutEndpointIds?.length ?? 0) === 2)).toBe(true);
  });

  it("advanced study row × x col × color endpoints yields multi-curve per cell", () => {
    const loadedStudy = wide({
      id: [1, 2, 3, 4],
      study: ["52", "81", "52", "81"],
      sex: ["F", "M", "F", "M"],
      dose: ["Pbo", "600", "Pbo", "600"],
      auc: [0, 100, 0, 120],
      cmax: [0, 10, 0, 12],
      icgi: [0, 1, 1, 0],
      icgi2: [0, 0, 1, 1]
    });
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [{ kind: "variable", variableId: "study" }],
      colDimensions: [{ kind: "xMetrics", ids: ["auc"], order: ["auc"] }],
      color: { kind: "endpoints" },
      fitByColor: false,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    expect(isGuidedCompareTopology(spec)).toBe(false);
    const scatter = enumerateScatterPanels(loadedStudy, [], spec, {
      xMetricIds: ["auc"],
      endpointIds: ["icgi", "icgi2"]
    });
    expect(scatter).toHaveLength(2);
    expect(scatter.every((p) => (p.endpointIds?.length ?? 0) === 2)).toBe(true);
    expect(scatter.some((p) => p.facetKey.study === "52")).toBe(true);
    expect(scatter.some((p) => p.facetKey.study === "81")).toBe(true);
  });

  it("advanced study row × endpoint col yields single endpoint per panel", () => {
    const loadedStudy = wide({
      id: [1, 2, 3, 4],
      study: ["52", "81", "52", "81"],
      dose: ["Pbo", "600", "Pbo", "600"],
      auc: [0, 100, 0, 120],
      icgi: [0, 1, 1, 0],
      icgi2: [0, 0, 1, 1]
    });
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [{ kind: "variable", variableId: "study" }],
      colDimensions: [{ kind: "endpoints", ids: ["icgi", "icgi2"], order: ["icgi", "icgi2"] }],
      color: { kind: "dose" },
      fitByColor: false,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
    const scatter = enumerateScatterPanels(loadedStudy, [], spec, {
      xMetricIds: ["auc"],
      endpointIds: ["icgi", "icgi2"]
    });
    expect(scatter).toHaveLength(4);
    expect(scatter.every((p) => !p.endpointIds || p.endpointIds.length <= 1)).toBe(true);
  });

  it("dedupeFacetDimensions removes row duplicate when also on columns", () => {
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [{ kind: "variable", variableId: "study" }],
      colDimensions: [
        { kind: "variable", variableId: "study" },
        { kind: "xMetrics", ids: ["auc"], order: ["auc"] }
      ],
      color: { kind: "dose" },
      fitByColor: false,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
    const deduped = dedupeFacetDimensions(spec);
    expect(deduped.rowDimensions).toHaveLength(0);
  });

  it("sex row × study col × endpoint color produces distinct panel cohorts", () => {
    const spec: ViewLayoutSpec = {
      mode: "advanced",
      rowDimensions: [{ kind: "variable", variableId: "sex", order: ["F", "M"] }],
      colDimensions: [{ kind: "xMetrics", ids: ["auc"], order: ["auc"] }],
      color: { kind: "variable", variableId: "sex" },
      fitByColor: true,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const scatter = enumerateScatterPanels(loaded, [], spec, { xMetricIds: ["auc"], endpointIds: ["icgi"] });
    expect(scatter).toHaveLength(2);
    expect(scatter[0]!.rowIndices).not.toEqual(scatter[1]!.rowIndices);
  });
});
