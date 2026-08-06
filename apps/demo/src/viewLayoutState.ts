import type { LayoutDimension, ViewLayoutSpec } from "@er-explorer/domain";
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

/** Keep endpoint/x-metric facets aligned with Analysis checkboxes (order preserved). */
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

  let rowDimensions = spec.rowDimensions.map(syncDim);
  let colDimensions = spec.colDimensions.map(syncDim);

  const dims = [...rowDimensions, ...colDimensions];
  const hasX = dims.some((d) => d.kind === "xMetrics");
  const hasEp = dims.some((d) => d.kind === "endpoints") || spec.endpointOverlay;

  if (!hasX && xMetricIds.length) {
    const order = mergeSelectedIds(xMetricIds, xMetricOrder);
    colDimensions = [...colDimensions, { kind: "xMetrics", ids: order, order }];
  }
  if (!hasEp && endpointIds.length) {
    const order = mergeSelectedIds(endpointIds, endpointOrder);
    rowDimensions = [{ kind: "endpoints", ids: order, order }, ...rowDimensions];
  }

  return { ...spec, rowDimensions, colDimensions };
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

export function defaultAdvancedLayout(
  endpointIds: string[],
  endpointOrder: string[],
  xMetricIds: string[],
  xMetricOrder: string[]
): ViewLayoutSpec {
  const ep = mergeSelectedIds(endpointIds, endpointOrder);
  const xm = mergeSelectedIds(xMetricIds, xMetricOrder);
  return {
    mode: "advanced",
    rowDimensions: ep.length ? [{ kind: "endpoints", ids: ep, order: ep }] : [],
    colDimensions: xm.length ? [{ kind: "xMetrics", ids: xm, order: xm }] : [],
    color: { kind: "dose" },
    fitByColor: false,
    continuousBinning: "median",
    distribution: { linkage: "shared_by_x_column", colorDistShapes: false }
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
    return `Color is "${v}" and "${v}" is also a row/column facet — each panel shows one ${v} level (separate rows/columns). Points and curves use that level’s color; turn on “Fit separately per color group” only when several ${v} levels appear in the same panel.`;
  }
  return null;
}