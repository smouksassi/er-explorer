import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "./viewLayout";
import {
  resolveDistVisualContext,
  resolveLegendShowsEndpoints,
  resolvePanelVisualPolicy
} from "./panelVisualPolicy";

const base: ViewLayoutSpec = {
  mode: "advanced",
  rowDimensions: [],
  colDimensions: [{ kind: "xMetrics", ids: ["auc"], order: ["auc"] }],
  color: { kind: "dose" },
  fitByColor: false,
  distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
};

describe("resolvePanelVisualPolicy", () => {
  it("dose color → dose points, no dist split", () => {
    const p = resolvePanelVisualPolicy(base, { facetKey: {}, endpointId: "icgi" }, ["icgi", "icgi2"]);
    expect(p.scatterPointColorSource).toBe("dose");
    expect(p.distSplitMode).toBe("none");
    expect(p.useEndpointColorForProjections).toBe(false);
  });

  it("color endpoints, multi-curve cell → endpoint multi + dist split when colorDistShapes", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      color: { kind: "endpoints" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const p = resolvePanelVisualPolicy(
      spec,
      { facetKey: {}, endpointId: "icgi", endpointIds: ["icgi", "icgi2"] },
      ["icgi", "icgi2"]
    );
    expect(p.scatterPointColorSource).toBe("endpointMulti");
    expect(p.distSplitMode).toBe("endpoints");
    expect(p.distSplitEndpointIds).toEqual(["icgi", "icgi2"]);
    expect(p.useEndpointColorForProjections).toBe(true);
    expect(p.useNeutralDistShapes).toBe(false);
  });

  it("color endpoints without split → dose dist, omit multi readout fit", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      color: { kind: "endpoints" },
      distribution: { linkage: "shared_by_x_column", colorDistShapes: false }
    };
    const p = resolvePanelVisualPolicy(
      spec,
      { facetKey: {}, endpointId: "icgi", endpointIds: ["icgi", "icgi2"] },
      ["icgi", "icgi2"]
    );
    expect(p.distSplitMode).toBe("none");
    expect(p.omitPerEndpointFitInReadout).toBe(true);
    expect(p.useNeutralDistShapes).toBe(false);
    expect(p.distUsesEndpointColorWhenUnsplit).toBe(false);
  });

  it("endpoint row facet + color endpoints → monochrome endpoint per panel", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      rowDimensions: [{ kind: "endpoints", ids: ["icgi", "icgi2"], order: ["icgi", "icgi2"] }],
      color: { kind: "endpoints" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const p = resolvePanelVisualPolicy(
      spec,
      { facetKey: { endpoint: "icgi" }, endpointId: "icgi" },
      ["icgi", "icgi2"]
    );
    expect(p.scatterPointColorSource).toBe("endpointMonochrome");
    expect(p.distSplitMode).toBe("none");
    expect(p.curveEndpointIds).toEqual(["icgi"]);
    expect(p.distUsesEndpointColorWhenUnsplit).toBe(true);
  });

  it("color variable + colorDistShapes → split by variable", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      color: { kind: "variable", variableId: "sex" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const p = resolvePanelVisualPolicy(spec, { facetKey: {}, endpointId: "icgi" }, ["icgi"]);
    expect(p.scatterPointColorSource).toBe("variable");
    expect(p.distSplitMode).toBe("colorVariable");
    expect(p.distSplitColorVariableId).toBe("sex");
  });
});

describe("resolveDistVisualContext", () => {
  it("compare stack ids → endpoint split when spec allows", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      mode: "guided",
      color: { kind: "endpoints" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: true }
    };
    const ctx = resolveDistVisualContext(
      spec,
      { compareEndpointIds: ["icgi", "icgi2"], fallbackEndpointId: "icgi" },
      ["icgi", "icgi2"]
    );
    expect(ctx.splitByEndpointIds).toEqual(["icgi", "icgi2"]);
    expect(ctx.omitPerEndpointFitInReadout).toBe(false);
  });

  it("collapsed endpoint-ROWS strip reads out EVERY endpoint it serves (one fit line each)", () => {
    // Endpoints faceted to rows: BRLS and PRLS scatter panels share ONE strip
    // (Slice D collapse). The readout endpoints are the strip's own list, not
    // a pseudo-panel's single curve endpoint (the bug that dropped PRLS).
    const spec: ViewLayoutSpec = {
      ...base,
      rowDimensions: [{ kind: "endpoints", ids: ["brls", "prls"], order: ["brls", "prls"] }],
      color: { kind: "dose" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
    const ctx = resolveDistVisualContext(
      spec,
      { compareEndpointIds: ["brls", "prls"], fallbackEndpointId: "brls" },
      ["brls", "prls"]
    );
    expect(ctx.splitByEndpointIds).toEqual([]);
    expect(ctx.readoutEndpointIds).toEqual(["brls", "prls"]);
    expect(ctx.omitPerEndpointFitInReadout).toBe(false);
  });

  it("per-column strip reads out ONLY its own endpoint (E3 P1)", () => {
    const spec: ViewLayoutSpec = {
      ...base,
      colDimensions: [{ kind: "endpoints", ids: ["icgi", "brls"], order: ["icgi", "brls"] }],
      color: { kind: "dose" },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
    const ctx = resolveDistVisualContext(
      spec,
      { compareEndpointIds: ["brls"], fallbackEndpointId: "brls" },
      ["icgi", "brls"]
    );
    expect(ctx.readoutEndpointIds).toEqual(["brls"]);
  });
});

describe("resolveLegendShowsEndpoints", () => {
  it("true when color is endpoints and 2+ selected", () => {
    expect(
      resolveLegendShowsEndpoints({ ...base, color: { kind: "endpoints" } }, ["icgi", "icgi2"])
    ).toBe(true);
  });
});
