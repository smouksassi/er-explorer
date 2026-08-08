import type { ScatterPanelSpec, ViewLayoutSpec } from "./viewLayout";
import { panelEndpointMode } from "./viewLayout";

/** How scatter points are colored for one panel. */
export type ScatterPointColorSource = "dose" | "endpointMonochrome" | "endpointMulti" | "variable";

/** How exposure-by-dose distribution rows are split within each dose. */
export type DistSplitMode = "none" | "endpoints" | "colorVariable";

/** Resolved visual rules for one scatter panel — spec only, no theme colors. */
export interface PanelVisualPolicy {
  scatterPrimaryEndpointId: string;
  curveEndpointIds: string[];
  scatterPointColorSource: ScatterPointColorSource;
  distSplitMode: DistSplitMode;
  distSplitEndpointIds: string[];
  distSplitColorVariableId?: string;
  /** When true, dose-click projections use endpoint accent colors (not dose palette). */
  useEndpointColorForProjections: boolean;
  /** When true, status/readout dose labels use neutral styling (multi-endpoint overlay). */
  useNeutralDoseLabelsInChrome: boolean;
  /** When true, distribution shapes use neutral fill (legacy compare without split). Deprecated path — prefer dose when unsplit. */
  useNeutralDistShapes: boolean;
  /** When true, readout skips per-endpoint fit lines (compare without dist split). */
  omitPerEndpointFitInReadout: boolean;
  legendUsesEndpointColors: boolean;
  /** Unsplit dose rows use this panel’s endpoint color (color=endpoints, one curve/cell). */
  distUsesEndpointColorWhenUnsplit: boolean;
}

export interface DistVisualContextInput {
  compareEndpointIds: string[];
  fallbackEndpointId: string;
  facetKey?: ScatterPanelSpec["facetKey"];
}

export interface DistVisualContext {
  splitByEndpointIds: string[];
  readoutEndpointIds: string[];
  splitByColorVariableId?: string;
  omitPerEndpointFitInReadout: boolean;
  useNeutralDistShapes: boolean;
  useNeutralDoseSelectionAccent: boolean;
}

function curveEndpointIdsForPanel(
  spec: ViewLayoutSpec,
  panel: Pick<ScatterPanelSpec, "facetKey" | "endpointId" | "endpointIds">,
  selectedEndpointIds: readonly string[]
): string[] {
  const mode = panelEndpointMode(spec, panel.facetKey, selectedEndpointIds.length);
  if (mode === "multiColor") {
    if (panel.endpointIds?.length) return [...panel.endpointIds];
    return [...selectedEndpointIds];
  }
  const fromFacet = panel.facetKey.endpoint;
  if (fromFacet) return [fromFacet];
  return [panel.endpointId];
}

/**
 * Derive scatter + dist visual rules from layout spec and one panel.
 * Endpoint is a grouping like any other: encoding comes from `spec.color`, not compare flags.
 */
export function resolvePanelVisualPolicy(
  spec: ViewLayoutSpec,
  panel: Pick<ScatterPanelSpec, "facetKey" | "endpointId" | "endpointIds">,
  selectedEndpointIds: readonly string[]
): PanelVisualPolicy {
  const curveEndpointIds = curveEndpointIdsForPanel(spec, panel, selectedEndpointIds);
  const primary = curveEndpointIds[0] ?? panel.endpointId;
  const multiCurve = curveEndpointIds.length > 1;
  const color = spec.color;
  const shapes = spec.distribution.colorDistShapes;

  let scatterPointColorSource: ScatterPointColorSource = "dose";
  if (color.kind === "variable") scatterPointColorSource = "variable";
  else if (color.kind === "endpoints") {
    scatterPointColorSource = multiCurve ? "endpointMulti" : "endpointMonochrome";
  }

  let distSplitMode: DistSplitMode = "none";
  let distSplitEndpointIds: string[] = [];
  let distSplitColorVariableId: string | undefined;

  if (shapes) {
    if (color.kind === "variable") {
      distSplitMode = "colorVariable";
      distSplitColorVariableId = color.variableId;
    } else if (color.kind === "endpoints" && multiCurve) {
      distSplitMode = "endpoints";
      distSplitEndpointIds = curveEndpointIds;
    }
  }

  const useEndpointColorForProjections = color.kind === "endpoints";
  const legendUsesEndpointColors = color.kind === "endpoints" && selectedEndpointIds.length > 1;
  const useNeutralDoseLabelsInChrome = color.kind === "endpoints" && multiCurve;
  const useNeutralDistShapes = false;
  const omitPerEndpointFitInReadout =
    color.kind === "endpoints" && multiCurve && distSplitMode === "none";
  const distUsesEndpointColorWhenUnsplit = color.kind === "endpoints" && distSplitMode === "none";

  return {
    scatterPrimaryEndpointId: primary,
    curveEndpointIds,
    scatterPointColorSource,
    distSplitMode,
    distSplitEndpointIds,
    distSplitColorVariableId,
    useEndpointColorForProjections,
    useNeutralDoseLabelsInChrome,
    useNeutralDistShapes,
    omitPerEndpointFitInReadout,
    legendUsesEndpointColors,
    distUsesEndpointColorWhenUnsplit
  };
}

/** Dist strip attached to a stack (scatter compare ids or single endpoint). */
export function resolveDistVisualContext(
  spec: ViewLayoutSpec,
  input: DistVisualContextInput,
  selectedEndpointIds: readonly string[]
): DistVisualContext {
  const panel: Pick<ScatterPanelSpec, "facetKey" | "endpointId" | "endpointIds"> = {
    facetKey: input.facetKey ?? {},
    endpointId: input.fallbackEndpointId,
    endpointIds:
      input.compareEndpointIds.length > 1 ? input.compareEndpointIds : undefined
  };
  const policy = resolvePanelVisualPolicy(spec, panel, selectedEndpointIds);

  const splitByEndpointIds =
    policy.distSplitMode === "endpoints" ? policy.distSplitEndpointIds : [];

  const readoutEndpointIds =
    splitByEndpointIds.length > 1
      ? splitByEndpointIds
      : policy.curveEndpointIds.length === 1
        ? policy.curveEndpointIds
        : selectedEndpointIds.length
          ? [...selectedEndpointIds]
          : [input.fallbackEndpointId];

  return {
    splitByEndpointIds,
    readoutEndpointIds,
    splitByColorVariableId: policy.distSplitColorVariableId,
    omitPerEndpointFitInReadout: policy.omitPerEndpointFitInReadout,
    useNeutralDistShapes: policy.useNeutralDistShapes,
    useNeutralDoseSelectionAccent: policy.useNeutralDoseLabelsInChrome
  };
}

/** Whether the main legend should list endpoints (vs dose / covariate). */
export function resolveLegendShowsEndpoints(
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[]
): boolean {
  return spec.color.kind === "endpoints" && selectedEndpointIds.length > 1;
}
