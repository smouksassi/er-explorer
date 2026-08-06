/**
 * Layout specification for exposure-response facet grids (Guided and Advanced).
 * Rendering and enumeration live in `@er-explorer/data` / the demo app; domain holds only shapes.
 */

/** One axis of the facet formula: endpoints, x-axis metrics, or a stratification variable. */
export type LayoutDimension =
  | { kind: "endpoints"; ids: string[]; order: string[] }
  | { kind: "xMetrics"; ids: string[]; order: string[] }
  | {
      kind: "variable";
      variableId: string;
      /** Restrict to these levels; omit = all distinct in filtered data. */
      levels?: string[];
      order?: string[];
    };

export type VariableColorBinning = "median" | "tertiles" | "quartiles";

export type ColorEncoding =
  | { kind: "dose" }
  | { kind: "endpoints" }
  | { kind: "variable"; variableId: string; binning?: VariableColorBinning };

export type DistributionLinkage =
  | "mirror_scatter_grid"
  | "shared_by_x_column"
  | "single_pooled"
  | "mirror_color_only";

export interface DistributionLayoutSpec {
  linkage: DistributionLinkage;
  /** When color ≠ dose, draw separate boxplot/violin shapes per color level within each dose row. */
  colorDistShapes: boolean;
}

export interface ViewLayoutSpec {
  mode: "guided" | "advanced";
  rowDimensions: LayoutDimension[];
  colDimensions: LayoutDimension[];
  color: ColorEncoding;
  fitByColor: boolean;
  /** Compare-endpoints overlay: one scatter row, multiple endpoints on same axes. */
  endpointOverlay?: boolean;
  distribution: DistributionLayoutSpec;
  /** Median/tertile/quartile bins for numeric covariates in color encoding and variable facets. */
  continuousBinning?: VariableColorBinning;
  /** Observed split-bin summaries; defaults to color variable when color is variable. */
  observedGroupVariableId?: string;
}

/** Resolved keys for one scatter panel (string values for all facet dimensions). */
export type FacetKey = Record<string, string>;

export interface ScatterPanelSpec {
  id: string;
  facetKey: FacetKey;
  xVariableId: string;
  endpointId: string;
  /** When endpointOverlay, all endpoints in this cell. */
  endpointIds?: string[];
  rowIndices: number[];
}

export interface DistPanelSpec {
  id: string;
  facetKey: FacetKey;
  xVariableId: string;
  /** Endpoint used for readout counts in distribution panel. */
  readoutEndpointId: string;
  readoutEndpointIds?: string[];
  rowIndices: number[];
  /** Scatter panel ids this dist cell aligns with (for linkage). */
  scatterPanelIds: string[];
}

/** True when endpoints are an explicit row/column facet (one panel per endpoint). */
export function layoutHasEndpointFacet(spec: ViewLayoutSpec): boolean {
  return [...spec.rowDimensions, ...spec.colDimensions].some((d) => d.kind === "endpoints");
}

/**
 * Guided-style multi-endpoint overlay on one axes. Disabled when endpoints are already faceted —
 * use column/row facets to split endpoints instead.
 */
export function effectiveEndpointOverlay(spec: ViewLayoutSpec): boolean {
  return !!spec.endpointOverlay && !layoutHasEndpointFacet(spec);
}

/** Open grouping key for stats shared between scatter and distribution. */
export type GroupKey = Record<string, string | number>;
