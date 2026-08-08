import type { DistributionLinkage, LayoutDimension, ViewLayoutSpec } from "@er-explorer/domain";

export type GuidedGridLayout = "endpoint-rows" | "exposure-rows";

export interface GuidedLayoutInput {
  gridLayout: GuidedGridLayout;
  compareEndpoints: boolean;
  compareDistByEndpoint: boolean;
  exposureMetricIds: string[];
  exposureColumnOrder: string[];
  endpointIds: string[];
  endpointColumnOrder: string[];
}

function mergeOrder(selected: string[], order: string[]): string[] {
  const set = new Set(selected);
  const out: string[] = [];
  for (const id of order) {
    if (set.has(id)) out.push(id);
  }
  for (const id of selected) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function endpointsDim(ids: string[], order: string[]): LayoutDimension {
  const o = mergeOrder(ids, order);
  return { kind: "endpoints", ids: o, order: o };
}

function xMetricsDim(ids: string[], order: string[]): LayoutDimension {
  const o = mergeOrder(ids, order);
  return { kind: "xMetrics", ids: o, order: o };
}

/** Map current Guided demo state to a `ViewLayoutSpec` (bijection for layout topology). */
export function guidedToViewLayoutSpec(input: GuidedLayoutInput): ViewLayoutSpec {
  const metrics = mergeOrder(input.exposureMetricIds, input.exposureColumnOrder);
  const endpoints = mergeOrder(input.endpointIds, input.endpointColumnOrder);

  if (input.compareEndpoints && endpoints.length > 1) {
    return {
      mode: "guided",
      rowDimensions: [],
      colDimensions: [xMetricsDim(metrics, input.exposureColumnOrder)],
      color: { kind: "endpoints" },
      fitByColor: false,
      endpointOverlay: true,
      distribution: {
        linkage: input.compareDistByEndpoint ? "mirror_scatter_grid" : "shared_by_x_column",
        colorDistShapes: input.compareDistByEndpoint
      }
    };
  }

  if (input.gridLayout === "exposure-rows") {
    return {
      mode: "guided",
      rowDimensions: [xMetricsDim(metrics, input.exposureColumnOrder)],
      colDimensions: [endpointsDim(endpoints, input.endpointColumnOrder)],
      color: { kind: "dose" },
      fitByColor: false,
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
  }

  return {
    mode: "guided",
    rowDimensions: [endpointsDim(endpoints, input.endpointColumnOrder)],
    colDimensions: [xMetricsDim(metrics, input.exposureColumnOrder)],
    color: { kind: "dose" },
    fitByColor: false,
    distribution: { linkage: "shared_by_x_column", colorDistShapes: false }
  };
}

export function defaultAdvancedSpecFromGuided(input: GuidedLayoutInput): ViewLayoutSpec {
  return { ...guidedToViewLayoutSpec(input), mode: "advanced", endpointOverlay: false };
}

export function distLinkageLabel(linkage: DistributionLinkage): string {
  switch (linkage) {
    case "mirror_scatter_grid":
      return "Mirror scatter facets";
    case "shared_by_x_column":
      return "Shared by exposure column (Guided default)";
    case "single_pooled":
      return "Single pooled row per exposure";
    case "mirror_color_only":
      return "Color-split boxplots only";
    default:
      return linkage;
  }
}
