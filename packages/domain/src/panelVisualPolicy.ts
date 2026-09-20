import type { ScatterPanelSpec, ViewLayoutSpec } from "./viewLayout";
import { layoutHasEndpointFacet, panelEndpointMode } from "./viewLayout";

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
  /**
   * @deprecated ADR-0012 one-color-channel rule: unsplit dose rows render NEUTRAL under
   * color=endpoints (see `resolveCellContext().distRows`). Demo no longer consumes this.
   */
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
  // Two genuinely different questions were sharing `multiCurve`: "does this
  // curve/strip grouping span more than one endpoint" (distSplitMode,
  // scatterPointColorSource — correct as `multiCurve` alone, endpoints on
  // rows included) vs. "are multiple endpoint CURVES painted together on one
  // shared, UNFACETED axis" (chrome neutrality, readout-fit omission — only
  // true for the genuine overlay case; a rows-faceted collapsed strip has no
  // such overlay to be redundant with, so it must NOT inherit this either).
  const multiCurveOverlaid = multiCurve && !layoutHasEndpointFacet(spec);

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
  const useNeutralDoseLabelsInChrome = color.kind === "endpoints" && multiCurveOverlaid;
  const useNeutralDistShapes = false;
  const omitPerEndpointFitInReadout =
    color.kind === "endpoints" && multiCurveOverlaid && distSplitMode === "none";
  const distUsesEndpointColorWhenUnsplit =
    color.kind === "endpoints" && distSplitMode === "none" && !multiCurve;

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

  // The strip's readout endpoints ARE the endpoints the strip serves —
  // `compareEndpointIds`, computed by the enumeration (per-column strip: that
  // column's endpoint; collapsed endpoint-rows strip: every endpoint merged
  // into it; split strip: the split list). The old derivation asked a
  // fabricated pseudo-panel (empty facetKey + fallback endpoint) for its CURVE
  // endpoints, which under any endpoint facet answered "single" — so a strip
  // shared by BRLS and PRLS rows read out only the first endpoint's fit line
  // (Slice-D open item, user-confirmed bug 2026-09-02).
  const readoutEndpointIds =
    splitByEndpointIds.length > 1
      ? splitByEndpointIds
      : input.compareEndpointIds.length
        ? [...input.compareEndpointIds]
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
