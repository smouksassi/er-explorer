/**
 * Layout specification for exposure-response facet grids (Guided and Advanced).
 * Rendering and enumeration live in `@er-explorer/data` / the demo app; domain holds only shapes.
 */

/** One axis of the facet formula: endpoints, x-axis metrics, or a stratification variable. */
export type LayoutDimension =
  | { kind: "endpoints"; ids: string[]; order: string[]; implicit?: boolean }
  | { kind: "xMetrics"; ids: string[]; order: string[]; implicit?: boolean }
  | {
      kind: "variable";
      variableId: string;
      /** Restrict to these levels; omit = all distinct in filtered data. */
      levels?: string[];
      order?: string[];
      /**
       * Added by {@link ensureScaleBearingFacets}, never by the user: recomputed on
       * every spec resolution, hidden from layout UI controls, and yields as soon
       * as the user authors this dimension on either axis.
       */
      implicit?: boolean;
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

/** Reserved grouping id for the dose role (dose is a design variable, not a data column id). */
export const DOSE_GROUPING_ID = "dose";

/**
 * Explicit statistical grouping (rethink §J, adopted 2026-08-21 — ggplot2 `group`
 * analog): curves/fits exist per endpoint × declared group. CHANNELS (color,
 * later linetype) are paint, never statistics — they partition marks, not fits.
 * Endpoint is not a grouping choice (it is the y variable). Empty = one pooled
 * curve per endpoint per cell.
 */
export interface GroupingSpec {
  /** Covariate column ids and/or {@link DOSE_GROUPING_ID}, in nesting order. */
  variableIds: string[];
}

export interface ViewLayoutSpec {
  mode: "guided" | "advanced";
  rowDimensions: LayoutDimension[];
  colDimensions: LayoutDimension[];
  color: ColorEncoding;
  /** Statistical grouping of curves/fits. Resolve via {@link resolveGrouping} (handles legacy specs). */
  grouping?: GroupingSpec;
  /**
   * @deprecated Superseded by {@link GroupingSpec} (rethink §J). Read only by
   * {@link resolveGrouping} to migrate persisted sessions; never written anew.
   */
  fitByColor?: boolean;
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
 * A dimension cannot facet both rows and columns (e.g. endpoints on both axes).
 * An authored (explicit) dimension always beats an implicit one regardless of
 * axis; between two authored duplicates, columns win.
 */
export function dedupeFacetDimensions(spec: ViewLayoutSpec): ViewLayoutSpec {
  const colDimensions = spec.colDimensions.filter(
    (d) =>
      !(
        d.implicit &&
        spec.rowDimensions.some((r) => !r.implicit && dimensionFacetKey(r) === dimensionFacetKey(d))
      )
  );
  const keptColKeys = new Set(colDimensions.map(dimensionFacetKey));
  const rowDimensions = spec.rowDimensions.filter((d) => !keptColKeys.has(dimensionFacetKey(d)));
  if (rowDimensions.length === spec.rowDimensions.length && colDimensions.length === spec.colDimensions.length) {
    return spec;
  }
  return { ...spec, rowDimensions, colDimensions };
}

/**
 * ADR-0012 scale-bearing rule, enforced: a scale-bearing variable with more than
 * one level in play must be faceted. When the layout doesn't place it, the facet
 * is IMPLICIT — exposure metrics join the columns (each level owns an x-axis);
 * endpoints join the rows unless they legally overlay via `color=endpoints`.
 * Silently dropping levels (e.g. only the first metric rendering) is never an
 * option.
 */
export function ensureScaleBearingFacets(
  spec: ViewLayoutSpec,
  xMetricIds: readonly string[],
  endpointIds: readonly string[]
): ViewLayoutSpec {
  // Drop previously-added implicit dims first: they are derived state, recomputed
  // here from scratch, and must never outrank a facet the user just authored
  // (a persisted implicit column would win dedupe over an authored row).
  let next: ViewLayoutSpec = {
    ...spec,
    rowDimensions: spec.rowDimensions.filter((d) => !d.implicit),
    colDimensions: spec.colDimensions.filter((d) => !d.implicit)
  };
  const hasXFacet = [...next.rowDimensions, ...next.colDimensions].some((d) => d.kind === "xMetrics");
  if (xMetricIds.length > 1 && !hasXFacet) {
    next = {
      ...next,
      colDimensions: [
        ...next.colDimensions,
        { kind: "xMetrics", ids: [...xMetricIds], order: [...xMetricIds], implicit: true }
      ]
    };
  }
  const hasEndpointFacet = [...next.rowDimensions, ...next.colDimensions].some(
    (d) => d.kind === "endpoints"
  );
  if (endpointIds.length > 1 && !hasEndpointFacet && next.color.kind !== "endpoints") {
    next = {
      ...next,
      rowDimensions: [
        ...next.rowDimensions,
        { kind: "endpoints", ids: [...endpointIds], order: [...endpointIds], implicit: true }
      ]
    };
  }
  return next;
}

/** Open grouping key for stats shared between scatter and distribution. */
export type GroupKey = Record<string, string | number>;

/**
 * The one reader of curve grouping. Migrates legacy `fitByColor` specs
 * (persisted sessions): fit-by-color with a variable channel grouped by that
 * variable; with the dose channel, by dose; otherwise pooled.
 */
export function resolveGrouping(spec: ViewLayoutSpec | null | undefined): string[] {
  if (!spec) return [];
  if (spec.grouping) return spec.grouping.variableIds;
  if (!spec.fitByColor) return [];
  if (spec.color.kind === "variable") return [spec.color.variableId];
  if (spec.color.kind === "dose") return [DOSE_GROUPING_ID];
  return [];
}

/** Normalize a (possibly legacy) spec to carry explicit `grouping` and no `fitByColor`. */
export function withResolvedGrouping(spec: ViewLayoutSpec): ViewLayoutSpec {
  const variableIds = resolveGrouping(spec);
  if (spec.grouping && spec.fitByColor === undefined) return spec;
  const { fitByColor: _legacy, ...rest } = spec;
  return { ...rest, grouping: { variableIds } };
}
