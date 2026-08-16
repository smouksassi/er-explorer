/**
 * ADR-0012 unified encoding grammar — the one resolver every visual layer consumes.
 *
 * A layout assigns grouping variables to five roles (y = endpoints, x = exposure
 * metrics, facet rows/cols, color). For each enumerated cell this module resolves,
 * once, everything a paint path is allowed to know:
 *
 *   - the facet cohort (rows for this cell),
 *   - the analysis groups within it (fit units and observed-summary units),
 *   - the distribution-row policy (split + palette under the one-color-channel rule),
 *   - the reference-split scope (always the exposure-metric population).
 *
 * Layers must not consult globals (filtered indices, fit caches) or re-derive
 * grouping from ad hoc flags. Dataset access stays outside `domain`: callers
 * inject the color-level accessor, keeping every function here pure.
 */

import type { ScatterPanelSpec, ViewLayoutSpec } from "./viewLayout";
import { panelEndpointMode } from "./viewLayout";

/**
 * One categorical color channel per view (ADR-0012): what the palette means.
 * Elements not grouped by this channel render neutral ink.
 */
export type ResolvedColorChannel =
  | { kind: "dose" }
  | { kind: "endpoints"; endpointIds: string[] }
  | { kind: "variable"; variableId: string; levels: string[] };

/** A fit unit: one curve = one (endpoint × optional color level) within the cell cohort. */
export interface CurveGroup {
  endpointId: string;
  /** Color-variable level when fitting per level; undefined = pooled over levels. */
  level?: string;
  /** Rows this curve is fitted on (subset of facetCohort; missing-level rows excluded). */
  rows: number[];
  /** Palette key: endpoint id under color=endpoints, level under color=variable, "" = neutral/default. */
  colorKey: string;
}

/** An observed-summary unit: callouts/markers computed per (endpoint × level present). */
export interface ObservedGroup {
  endpointId: string;
  level?: string;
  rows: number[];
  colorKey: string;
}

/**
 * How the exposure-by-dose distribution strip splits and colors its rows.
 * The strip describes exposure — it never carries endpoint identity
 * (endpoint rows dedup upstream; only genuine missingness differences split strips).
 */
export interface DistRowPolicy {
  /** Color-variable levels each dose row splits into; empty = one row per dose. */
  splitLevels: string[];
  /** Palette under the one-channel rule: dose colors, variable-level colors, or neutral ink (color=endpoints). */
  palette: "dose" | "variable" | "neutral";
  variableId?: string;
}

/** Everything a paint path may know about one cell. */
export interface ResolvedCellContext {
  panelId: string;
  xMetricId: string;
  /** One entry = single-endpoint cell; more = same-scale overlay (rescaled per Analysis config). */
  endpointIds: string[];
  /** Facet slice ∩ data filters — the analysis cohort for every layer in this cell. */
  facetCohort: number[];
  colorChannel: ResolvedColorChannel;
  curveGroups: CurveGroup[];
  observedGroups: ObservedGroup[];
  distRows: DistRowPolicy;
  /**
   * ADR-0012: reference-split cut points are computed per exposure metric on all
   * available exposure values (all doses pooled, placebo/SoC/design-zeros excluded),
   * independent of endpoint missingness. Constant scope — recorded so paint paths
   * never invent another.
   */
  splitCohortScope: "metricPopulation";
  /** Linked x-domain key: panels sharing this key share x-axis limits. */
  xDomainKey: string;
}

/** Dataset access injected by the caller (`@er-explorer/data` / demo) — keeps domain pure. */
export interface CellResolutionInput {
  spec: ViewLayoutSpec;
  panel: Pick<ScatterPanelSpec, "id" | "facetKey" | "xVariableId" | "endpointId" | "endpointIds" | "rowIndices">;
  selectedEndpointIds: readonly string[];
  /**
   * Ordered color-variable levels present in this panel's cohort (from the caller's
   * bin model). Required when `spec.color.kind === "variable"`.
   */
  colorLevels?: readonly string[];
  /**
   * Level of the color variable for a row; `null` = missing (row stays in the facet
   * cohort but joins no level group). Required when `spec.color.kind === "variable"`.
   */
  levelForRow?: (variableId: string, rowIndex: number) => string | null;
}

function endpointIdsForCell(input: CellResolutionInput): string[] {
  const { spec, panel, selectedEndpointIds } = input;
  if (panel.endpointIds?.length) return [...panel.endpointIds];
  const mode = panelEndpointMode(spec, panel.facetKey, selectedEndpointIds.length);
  if (mode === "multiColor") return [...selectedEndpointIds];
  const fromFacet = panel.facetKey.endpoint;
  if (fromFacet) return [fromFacet];
  return panel.endpointId ? [panel.endpointId] : [...selectedEndpointIds.slice(0, 1)];
}

function levelRows(
  input: CellResolutionInput,
  variableId: string,
  level: string
): number[] {
  const accessor = input.levelForRow;
  if (!accessor) return [];
  return input.panel.rowIndices.filter((i) => accessor(variableId, i) === level);
}

/**
 * Levels actually present in this cell. With the same variable on facet and color
 * (legal, degenerate — ADR-0012), a panel usually holds a single level: encoding
 * stays that level's color so identity survives facet toggling.
 */
function presentColorLevels(input: CellResolutionInput, variableId: string): string[] {
  const declared = input.colorLevels ?? [];
  return declared.filter((level) => levelRows(input, variableId, level).length > 0);
}

/**
 * Resolve one cell of the layout into the context every layer consumes.
 * Pure: all dataset knowledge arrives via {@link CellResolutionInput}.
 */
export function resolveCellContext(input: CellResolutionInput): ResolvedCellContext {
  const { spec, panel } = input;
  const endpointIds = endpointIdsForCell(input);
  const facetCohort = [...panel.rowIndices];
  const color = spec.color;

  let colorChannel: ResolvedColorChannel;
  let curveGroups: CurveGroup[];
  let observedGroups: ObservedGroup[];
  let distRows: DistRowPolicy;

  if (color.kind === "variable") {
    const variableId = color.variableId;
    const levels = presentColorLevels(input, variableId);
    colorChannel = { kind: "variable", variableId, levels };

    observedGroups = endpointIds.flatMap((endpointId) =>
      levels.map((level) => ({
        endpointId,
        level,
        rows: levelRows(input, variableId, level),
        colorKey: level
      }))
    );

    const fitPerLevel = spec.fitByColor && levels.length > 1;
    curveGroups = endpointIds.flatMap((endpointId) =>
      fitPerLevel
        ? levels.map((level) => ({
            endpointId,
            level,
            rows: levelRows(input, variableId, level),
            colorKey: level
          }))
        : [
            {
              endpointId,
              rows: facetCohort,
              // Degenerate facet+color: a single-level cell keeps its level color.
              colorKey: levels.length === 1 ? levels[0]! : ""
            }
          ]
    );

    // One channel: rows split by level wear the level palette; a single-level cell
    // keeps its level color; unsplit multi-level rows are grouped by dose only and
    // therefore render NEUTRAL (dose palette would be a second color channel).
    distRows = spec.distribution.colorDistShapes && levels.length > 1
      ? { splitLevels: levels, palette: "variable", variableId }
      : levels.length === 1
        ? { splitLevels: [], palette: "variable", variableId }
        : { splitLevels: [], palette: "neutral" };
  } else if (color.kind === "endpoints") {
    colorChannel = { kind: "endpoints", endpointIds };
    curveGroups = endpointIds.map((endpointId) => ({
      endpointId,
      rows: facetCohort,
      colorKey: endpointId
    }));
    observedGroups = endpointIds.map((endpointId) => ({
      endpointId,
      rows: facetCohort,
      colorKey: endpointId
    }));
    // One color channel per view: the strip describes exposure, not endpoints —
    // rows render neutral; dose identity is the row label (ADR-0012).
    distRows = { splitLevels: [], palette: "neutral" };
  } else {
    colorChannel = { kind: "dose" };
    curveGroups = endpointIds.map((endpointId) => ({
      endpointId,
      rows: facetCohort,
      colorKey: ""
    }));
    observedGroups = endpointIds.map((endpointId) => ({
      endpointId,
      rows: facetCohort,
      colorKey: ""
    }));
    distRows = { splitLevels: [], palette: "dose" };
  }

  return {
    panelId: panel.id,
    xMetricId: panel.xVariableId,
    endpointIds,
    facetCohort,
    colorChannel,
    curveGroups,
    observedGroups,
    distRows,
    splitCohortScope: "metricPopulation",
    xDomainKey: panel.xVariableId
  };
}
