import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "./viewLayout";
import { resolveOverlayCohortPolicy } from "./overlayCohortPolicy";

const base: ViewLayoutSpec = {
  mode: "advanced",
  rowDimensions: [],
  colDimensions: [{ kind: "xMetrics", ids: ["auc"], order: ["auc"] }],
  color: { kind: "dose" },
  fitByColor: false,
  distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
};

describe("resolveOverlayCohortPolicy", () => {
  it("always uses endpoint×metric for reference split positions", () => {
    const p = resolveOverlayCohortPolicy(
      base,
      { facetKey: { sex: "1" }, endpointId: "icgi" },
      ["icgi"]
    );
    expect(p.referenceSplitPositions).toBe("endpointAndMetric");
    expect(p.displayMinMax).toBe("panelFacet");
    expect(p.observedAtSplit).toBe("panelFacet");
  });

  it("observed at split per color level when color variable in cell", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      color: { kind: "variable", variableId: "sex" }
    };
    const p = resolveOverlayCohortPolicy(spec, { facetKey: {}, endpointId: "icgi" }, ["icgi"]);
    expect(p.observedAtSplit).toBe("colorLevelWithinPanel");
    expect(p.splitAnnotationOnDist).toBe("colorLevelWithinPanel");
  });

  it("dist split annotations per level when colorDistShapes + variable color", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      color: { kind: "variable", variableId: "wt" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const p = resolveOverlayCohortPolicy(spec, { facetKey: {}, endpointId: "icgi" }, ["icgi"]);
    expect(p.splitAnnotationOnDist).toBe("colorLevelWithinPanel");
  });

  it("sex on row facet + dose color → panel facet only for observed", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      rowDimensions: [{ kind: "variable", variableId: "sex", order: ["1", "2"] }],
      color: { kind: "dose" }
    };
    const p = resolveOverlayCohortPolicy(
      spec,
      { facetKey: { sex: "1" }, endpointId: "icgi" },
      ["icgi"]
    );
    expect(p.observedAtSplit).toBe("panelFacet");
  });
});
