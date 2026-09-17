import type { LayoutDimension, ViewLayoutSpec } from "@er-explorer/domain";

/** Guided presets (rethink §D.1): 3 ready-made specs; covariates are Advanced-only. */
export type GuidedPresetId = "endpoint-rows" | "exposure-rows" | "overlay";

export interface GuidedLayoutInput {
  preset: GuidedPresetId;
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

  if (input.preset === "overlay" && endpoints.length > 1) {
    return {
      mode: "guided",
      rowDimensions: [],
      colDimensions: [xMetricsDim(metrics, input.exposureColumnOrder)],
      color: { kind: "endpoints" },
      // Law B: presets WRITE channel mappings, rules carry no gates — the
      // overlay's dash-by-endpoint look is this explicit mapping, not a default.
      linetype: { kind: "endpoints" },
      grouping: { variableIds: [] },
      endpointOverlay: true,
      distribution: {
        linkage: input.compareDistByEndpoint ? "mirror_scatter_grid" : "shared_by_x_column",
        colorDistShapes: input.compareDistByEndpoint
      }
    };
  }

  if (input.preset === "exposure-rows") {
    return {
      mode: "guided",
      rowDimensions: [xMetricsDim(metrics, input.exposureColumnOrder)],
      colDimensions: [endpointsDim(endpoints, input.endpointColumnOrder)],
      color: { kind: "dose" },
      grouping: { variableIds: [] },
      distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
    };
  }

  return {
    mode: "guided",
    rowDimensions: [endpointsDim(endpoints, input.endpointColumnOrder)],
    colDimensions: [xMetricsDim(metrics, input.exposureColumnOrder)],
    color: { kind: "dose" },
    grouping: { variableIds: [] },
    distribution: { linkage: "shared_by_x_column", colorDistShapes: false }
  };
}

export function defaultAdvancedSpecFromGuided(input: GuidedLayoutInput): ViewLayoutSpec {
  return { ...guidedToViewLayoutSpec(input), mode: "advanced", endpointOverlay: false };
}
