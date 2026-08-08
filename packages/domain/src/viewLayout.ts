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

/** Column facets are exactly one xMetrics dimension (Guided compare default). */
export function colDimensionsAreOnlyXMetrics(spec: ViewLayoutSpec): boolean {
  return (
    spec.colDimensions.length === 1 &&
    spec.colDimensions[0]!.kind === "xMetrics" &&
    spec.rowDimensions.length === 0
  );
}

/**
 * Guided “Compare endpoints”: one scatter row, columns = exposures only, endpoints distinguished by color.
 * Advanced never uses the overlay mount shell — use facet grid + `endpointIds` per cell instead.
 */
export function isGuidedCompareTopology(spec: ViewLayoutSpec): boolean {
  if (spec.mode !== "guided") return false;
  if (layoutHasEndpointFacet(spec)) return false;
  return effectiveEndpointOverlay(spec) && colDimensionsAreOnlyXMetrics(spec);
}

/** @deprecated Use {@link isGuidedCompareTopology} for mount overlay; Advanced uses facet grid only. */
export function usesEndpointColorOverlay(spec: ViewLayoutSpec, _selectedEndpointCount: number): boolean {
  return isGuidedCompareTopology(spec);
}

export type PanelEndpointMode = "single" | "multiColor";

/** Whether this cell shows one endpoint or multiple curves colored by endpoint. */
export function panelEndpointMode(
  spec: ViewLayoutSpec,
  facetKey: FacetKey,
  selectedEndpointCount: number
): PanelEndpointMode {
  if (selectedEndpointCount <= 1) return "single";
  if (facetKey.endpoint) return "single";
  if (layoutHasEndpointFacet(spec)) return "single";
  if (spec.color.kind === "endpoints") return "multiColor";
  return "single";
}

/** Side-by-side endpoint boxplots within each dose row (compare / color=endpoints + colorDistShapes). */
export function distEndpointColorSplit(spec: ViewLayoutSpec, selectedEndpointCount: number): boolean {
  if (selectedEndpointCount < 2 || layoutHasEndpointFacet(spec)) return false;
  return spec.color.kind === "endpoints" && spec.distribution.colorDistShapes;
}

function dimensionFacetKey(dim: LayoutDimension): string {
  return dim.kind === "variable" ? `var:${dim.variableId}` : dim.kind;
}

/**
 * A dimension cannot facet both rows and columns (e.g. endpoints on both axes). Column facets win;
 * duplicates are removed from rows.
 */
export function dedupeFacetDimensions(spec: ViewLayoutSpec): ViewLayoutSpec {
  const colKeys = new Set(spec.colDimensions.map(dimensionFacetKey));
  const rowDimensions = spec.rowDimensions.filter((d) => !colKeys.has(dimensionFacetKey(d)));
  return rowDimensions.length === spec.rowDimensions.length ? spec : { ...spec, rowDimensions };
}

/** Open grouping key for stats shared between scatter and distribution. */
export type GroupKey = Record<string, string | number>;
