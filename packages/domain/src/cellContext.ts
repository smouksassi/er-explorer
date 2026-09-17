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
 *
 * Rethink §J (adopted 2026-08-21): curve/fit units come from the EXPLICIT
 * `grouping` spec — channels are paint, never statistics. The constancy theorem
 * decides what a curve wears: a curve carries a channel's encoding iff the
 * channel's variable is constant within the curve's group; otherwise neutral ink.
 */

import type { ScatterPanelSpec, ViewLayoutSpec } from "./viewLayout";
import { DOSE_GROUPING_ID, panelEndpointMode, resolveGrouping } from "./viewLayout";

/**
 * One categorical color channel per view (ADR-0012): what the palette means.
 * Elements not grouped by this channel render neutral ink.
 */
export type ResolvedColorChannel =
  | { kind: "dose" }
  | { kind: "endpoints"; endpointIds: string[] }
  | { kind: "variable"; variableId: string; levels: string[] };

/** Composite grouping keys join levels with this separator (single-var keys are the bare level). */
export const GROUP_KEY_SEPARATOR = " · ";

/** A fit unit: one curve = one (endpoint × declared group) within the cell cohort. */
export interface CurveGroup {
  endpointId: string;
  /** Composite grouping key ("" = pooled: no grouping declared). */
  groupKey: string;
  /** Human label for the group (undefined when pooled). */
  level?: string;
  /** Rows this curve is fitted on (subset of facetCohort). */
  rows: number[];
  /**
   * Constancy theorem: the channel's palette key when the channel variable is
   * constant within this group's rows (level under color=variable, arm under
   * color=dose, endpoint id under color=endpoints); "" = neutral ink.
   */
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
  /**
   * Palette under the one-channel rule: dose colors, variable-level colors,
   * a single constant endpoint's accent ("endpoint" — constancy, same law as
   * the variable channel's single-level cell), or neutral ink.
   */
  palette: "dose" | "variable" | "endpoint" | "neutral";
  variableId?: string;
  /** The constant endpoint whose accent rows wear when `palette === "endpoint"`. */
  endpointId?: string;
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
  /**
   * Dose arms in display order. Dose is an ordinary categorical channel/grouping
   * variable (ADR-0012 — no exceptions). Required when the grouping declares
   * {@link DOSE_GROUPING_ID} or the dose channel needs constancy checks.
   */
  doseLevels?: readonly string[];
  /** Dose arm for a row; `null` = missing. Required with doseLevels. */
  doseForRow?: (rowIndex: number) => string | null;
  /**
   * Ordered levels (base-cohort model, "(missing)" last) of a declared grouping
   * variable other than dose. Required when `spec.grouping` names covariates.
   */
  groupingLevels?: (variableId: string) => readonly string[] | undefined;
  /** Grouping-variable level for a row; `null` = ungrouped (joins no curve). */
  groupingLevelForRow?: (variableId: string, rowIndex: number) => string | null;
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

/** One partition of the cell cohort per declared-group level combination. */
interface GroupPartition {
  key: string;
  /** Level chosen per grouping variable — lets constancy short-circuit when the channel is grouped. */
  values: ReadonlyMap<string, string>;
  rows: number[];
}

function groupingLevelsFor(input: CellResolutionInput, variableId: string): readonly string[] | undefined {
  if (variableId === DOSE_GROUPING_ID) return input.doseLevels;
  const declared = input.groupingLevels?.(variableId);
  if (declared?.length) return declared;
  // Grouping by the color variable shares the color model when no dedicated
  // accessor was injected (they are the same variable — cuts must agree).
  if (input.spec.color.kind === "variable" && input.spec.color.variableId === variableId) {
    return input.colorLevels;
  }
  return undefined;
}

function groupingValueFor(input: CellResolutionInput, variableId: string, rowIndex: number): string | null {
  if (variableId === DOSE_GROUPING_ID) return input.doseForRow?.(rowIndex) ?? null;
  if (input.groupingLevelForRow) return input.groupingLevelForRow(variableId, rowIndex);
  if (input.spec.color.kind === "variable" && input.spec.color.variableId === variableId) {
    return input.levelForRow?.(variableId, rowIndex) ?? null;
  }
  return null;
}

/**
 * Partition the cell cohort by the declared grouping (§J). No grouping — or a
 * grouping variable without injected accessors — contributes no split; rows whose
 * grouping value is null join no curve (they remain cohort points).
 */
export function partitionCellByGrouping(input: CellResolutionInput): GroupPartition[] {
  let parts: GroupPartition[] = [{ key: "", values: new Map(), rows: [...input.panel.rowIndices] }];
  for (const variableId of resolveGrouping(input.spec)) {
    const levels = groupingLevelsFor(input, variableId);
    if (!levels?.length) continue;
    parts = parts.flatMap((p) =>
      levels
        .map((level) => ({
          key: p.key ? `${p.key}${GROUP_KEY_SEPARATOR}${level}` : level,
          values: new Map(p.values).set(variableId, level),
          rows: p.rows.filter((i) => groupingValueFor(input, variableId, i) === level)
        }))
        .filter((q) => q.rows.length > 0)
    );
  }
  return parts;
}

/** "" unless `valueOf` yields one identical non-null value across all rows. */
function constantChannelValue(rows: number[], valueOf: (rowIndex: number) => string | null): string {
  let seen: string | null = null;
  for (const i of rows) {
    const v = valueOf(i);
    if (v === null || v === undefined) return "";
    if (seen === null) seen = v;
    else if (seen !== v) return "";
  }
  return seen ?? "";
}

/** The constancy theorem (§J): what channel encoding this group's curve wears. */
function curveColorKey(input: CellResolutionInput, endpointId: string, part: GroupPartition): string {
  const color = input.spec.color;
  if (color.kind === "endpoints") return endpointId;
  if (color.kind === "variable") {
    const grouped = part.values.get(color.variableId);
    if (grouped !== undefined) return grouped;
    const accessor = input.levelForRow;
    if (!accessor) return "";
    return constantChannelValue(part.rows, (i) => accessor(color.variableId, i));
  }
  const groupedArm = part.values.get(DOSE_GROUPING_ID);
  if (groupedArm !== undefined) return groupedArm;
  const doseAccessor = input.doseForRow;
  if (!doseAccessor) return "";
  return constantChannelValue(part.rows, (i) => doseAccessor(i));
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

  // Curves: endpoint × declared group, channel encoding by constancy (§J) — one
  // law for every channel kind, including the degenerate facet+color cell (a
  // single-level cohort is constant, so the pooled curve keeps its level color).
  const partitions = partitionCellByGrouping(input);
  const curveGroups: CurveGroup[] = endpointIds.flatMap((endpointId) =>
    partitions.map((part) => ({
      endpointId,
      groupKey: part.key,
      level: part.key || undefined,
      rows: part.rows,
      colorKey: curveColorKey(input, endpointId, part)
    }))
  );

  let colorChannel: ResolvedColorChannel;
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
    observedGroups = endpointIds.map((endpointId) => ({
      endpointId,
      rows: facetCohort,
      colorKey: endpointId
    }));
    // Constancy — the SAME law as the variable branch's single-level case
    // above: a cell whose endpoint set is one endpoint has the channel constant
    // over its rows, so dist rows wear that endpoint's accent (per-column
    // strips, single-endpoint cells; user-confirmed bug 2026-09-17). A
    // multi-endpoint cell stays neutral — one strip cannot wear two endpoints;
    // dose identity is the row label (ADR-0012). NOTE: the CALLER owns the
    // mark's scope — a collapsed strip serving several single-endpoint cells
    // must evaluate constancy over the strip's own endpoint set, not one cell's.
    distRows =
      endpointIds.length === 1
        ? { splitLevels: [], palette: "endpoint", endpointId: endpointIds[0]! }
        : { splitLevels: [], palette: "neutral" };
  } else {
    colorChannel = { kind: "dose" };
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
