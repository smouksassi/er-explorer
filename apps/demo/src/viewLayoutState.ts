import type { LayoutDimension, ViewLayoutSpec } from "@er-explorer/domain";
import { dedupeFacetDimensions } from "@er-explorer/domain";
import { defaultAdvancedSpecFromGuided, guidedToViewLayoutSpec, type GuidedLayoutInput } from "./guidedViewLayout";

export type LayoutMode = "guided" | "advanced";

export interface DemoViewLayoutState {
  layoutMode: LayoutMode;
  /** When advanced, user-edited spec; when guided, derived each render from Guided controls. */
  advancedViewLayout: ViewLayoutSpec | null;
}

function mergeSelectedIds(selected: string[], order: string[]): string[] {
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

/** Refresh endpoint/x-metric id lists on existing facet dimensions only (never inject axes). */
export function syncAdvancedSpecWithAnalysis(
  spec: ViewLayoutSpec,
  endpointIds: string[],
  endpointOrder: string[],
  xMetricIds: string[],
  xMetricOrder: string[]
): ViewLayoutSpec {
  const syncDim = (dim: LayoutDimension): LayoutDimension => {
    if (dim.kind === "endpoints") {
      const order = mergeSelectedIds(endpointIds, dim.order.length ? dim.order : endpointOrder);
      return { kind: "endpoints", ids: order, order };
    }
    if (dim.kind === "xMetrics") {
      const order = mergeSelectedIds(xMetricIds, dim.order.length ? dim.order : xMetricOrder);
      return { kind: "xMetrics", ids: order, order };
    }
    return dim;
  };

  const synced: ViewLayoutSpec = {
    ...spec,
    rowDimensions: spec.rowDimensions.map(syncDim),
    colDimensions: spec.colDimensions.map(syncDim),
    endpointOverlay: spec.mode === "advanced" ? false : spec.endpointOverlay
  };
  return dedupeFacetDimensions(synced);
}

function normalizeAdvancedColorFit(spec: ViewLayoutSpec): ViewLayoutSpec {
  if (spec.color.kind === "variable") return spec;
  if (!spec.fitByColor) return spec;
  return { ...spec, fitByColor: false };
}

export function resolveViewLayoutSpec(
  mode: LayoutMode,
  guidedInput: GuidedLayoutInput,
  advancedViewLayout: ViewLayoutSpec | null,
  analysis?: {
    endpointIds: string[];
    endpointOrder: string[];
    xMetricIds: string[];
    xMetricOrder: string[];
  }
): ViewLayoutSpec {
  if (mode === "advanced" && advancedViewLayout) {
    let spec = advancedViewLayout;
    if (analysis) {
      spec = syncAdvancedSpecWithAnalysis(
        advancedViewLayout,
        analysis.endpointIds,
        analysis.endpointOrder,
        analysis.xMetricIds,
        analysis.xMetricOrder
      );
    }
    return normalizeAdvancedColorFit(spec);
  }
  return guidedToViewLayoutSpec(guidedInput);
}

/** Blank Advanced canvas: user adds row/column facets and color in Style (Analysis only filters ids). */
export function defaultAdvancedLayout(
  _endpointIds: string[],
  _endpointOrder: string[],
  _xMetricIds: string[],
  _xMetricOrder: string[]
): ViewLayoutSpec {
  return {
    mode: "advanced",
    rowDimensions: [],
    colDimensions: [],
    color: { kind: "dose" },
    fitByColor: false,
    continuousBinning: "median",
    distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false }
  };
}

export function resetAdvancedToGuided(guidedInput: GuidedLayoutInput): ViewLayoutSpec {
  return defaultAdvancedSpecFromGuided(guidedInput);
}

/** Warn when color variable is already used as a facet (one level per panel). */
export function layoutColorFacetConflict(spec: ViewLayoutSpec): string | null {
  if (spec.color.kind !== "variable") return null;
  const v = spec.color.variableId;
  const inRow = spec.rowDimensions.some((d) => d.kind === "variable" && d.variableId === v);
  const inCol = spec.colDimensions.some((d) => d.kind === "variable" && d.variableId === v);
  if (inRow || inCol) {
    return `Color is "${v}" and "${v}" is also a row/column facet — each panel is one ${v} level, so curves/points use dose colors here. Pick Dose or Endpoints for color, or remove "${v}" from facets to color by ${v} within a panel.`;
  }
  return null;
}
