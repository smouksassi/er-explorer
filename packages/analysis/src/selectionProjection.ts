/**
 * The selection → projection pipeline (ADR-0012/0013, invariants I1–I4, I8).
 *
 * ONE implementation for every model family: which rows a clicked dist group
 * means (dose ∩ level/endpoint ∩ panel cohort), which curve-granularity groups a
 * selection resolves to, what color a group wears, and the exposure-quantile +
 * observed-summary stats a projection carries.
 *
 * Rethink §J: projection granularity = the DECLARED GROUPING (I8 restated).
 * Each selected strip row's rows are partitioned by the grouping — one projected
 * group per curve group present — and `curveKey` associates a projection with
 * its curve structurally (no id-string parsing). Color follows the constancy
 * theorem: a projection wears the channel encoding iff the channel variable is
 * constant within its rows; otherwise neutral ink.
 *
 * Dataset access, palettes, and the family adapter are INJECTED — this module
 * imports domain types only, so the unit-level conformance matrix can execute it
 * directly per family with no DOM and no dataset machinery.
 */

import type { EndpointFamilyAdapter, ObservedGroupSummary, ViewLayoutSpec } from "@er-explorer/domain";
import { GROUP_KEY_SEPARATOR } from "@er-explorer/domain";
import type { SupportTier } from "./support";

/** Structural subset of the demo's ColorBinModel the pipeline needs. */
export interface SelectionLevelModel {
  levels: string[];
}

/** Exposure five-number summary; producer injected (summarizeDistribution).
 * Below full support (unified minimum-support rule) the producer abstains on
 * q1/q3/whiskers with NaN — projection painters draw only the finite markers. */
export interface ExposureSummary {
  tier: SupportTier;
  q1: number;
  q3: number;
  median: number;
  whiskerLow: number;
  whiskerHigh: number;
  min: number;
  max: number;
}

export interface SelectionProjectionCtx {
  spec: ViewLayoutSpec | null;
  /** Endpoint ids in play — disambiguates `dose|suffix` (endpoint vs level). */
  knownEndpointIds: readonly string[];
  selectedDistGroupIds: ReadonlySet<string>;
  selectedDoses: ReadonlySet<string>;
  /** Observed summaries attach only when the user shows them. */
  showObservedSummary: boolean;
  /** Color-variable level model built on the BASE cohort (I1) — null when color ≠ variable. */
  colorModel: SelectionLevelModel | null;
  /**
   * Ordered composite keys of the declared grouping on the BASE cohort
   * (curve granularity, I8); empty = no grouping (pooled curves).
   */
  groupingKeys: readonly string[];
  /** Composite grouping key for a row; null = joins no curve group. */
  groupingKeyForRow(rowIndex: number): string | null;
  rowIndicesForDose(dose: string): number[];
  /** Active-set membership for a row (brush/filter), by row index. */
  isActiveRow(rowIndex: number): boolean;
  /** Exposure value for the metric under projection. */
  exposureValue(rowIndex: number): number;
  endpointValue(rowIndex: number, endpointId: string): number;
  /** Color-variable level of a row under the base-cohort model; null = missing or no channel. */
  levelForRow(rowIndex: number): string | null;
  /** Dose arm of a row (channel constancy under color=dose); null = unknown. */
  doseForRow(rowIndex: number): string | null;
  summarizeExposures(sortedFiniteValues: number[]): ExposureSummary | null;
  colorForLevel(level: string): string;
  colorForEndpoint(endpointId: string): string;
  colorForDose(dose: string): string;
  neutralColor: string;
}

/** One projected group at curve granularity — family-agnostic. */
export interface ProjectedSelectionGroup extends ExposureSummary {
  groupId: string;
  /** Curve association (I4/I8): matches `CurveGroup.groupKey`; "" rides the pooled curve. */
  curveKey: string;
  /** Readout label: clicked row, plus the group key when the grouping refines it. */
  label: string;
  color: string;
  n: number;
  observedSummary?: ObservedGroupSummary;
}

function parseGid(gid: string): { dose: string; suffix?: string } {
  const sep = gid.indexOf("|");
  if (sep === -1) return { dose: gid };
  return { dose: gid.slice(0, sep), suffix: gid.slice(sep + 1) };
}

/** Dist group ids the current selection projects for this endpoint. */
export function selectionGids(ctx: SelectionProjectionCtx, endpointId: string): string[] {
  if (ctx.selectedDistGroupIds.size) {
    return [...ctx.selectedDistGroupIds].filter((gid) => {
      const { suffix } = parseGid(gid);
      if (!suffix) return true;
      if (ctx.knownEndpointIds.includes(suffix)) return suffix === endpointId;
      return true;
    });
  }
  if (ctx.selectedDoses.size) return [...ctx.selectedDoses];
  return [];
}

/** Rows a dist group id means: dose ∩ active ∩ panel cohort ∩ (level | endpoint-finite) — I3. */
export function rowsForGroup(
  ctx: SelectionProjectionCtx,
  gid: string,
  endpointId: string,
  cohortRowIndices?: number[]
): number[] {
  const { suffix } = parseGid(gid);
  const cohortSet = cohortRowIndices ? new Set(cohortRowIndices) : null;
  const rows = ctx
    .rowIndicesForDose(parseGid(gid).dose)
    .filter((i) => ctx.isActiveRow(i) && (!cohortSet || cohortSet.has(i)));
  if (!suffix) return rows;
  if (ctx.knownEndpointIds.includes(suffix)) {
    return rows.filter((i) => Number.isFinite(ctx.endpointValue(i, suffix)));
  }
  return rows.filter((i) => ctx.levelForRow(i) === suffix);
}

/**
 * I8 — granularity rule: a selection's rows are partitioned by the declared
 * grouping so every projected group rides exactly one curve (a pooled window
 * never rides a group curve). No grouping — one pooled partition (key "").
 */
export function partitionSelectionByGrouping(
  ctx: SelectionProjectionCtx,
  rows: number[]
): Array<{ key: string; rows: number[] }> {
  if (!ctx.groupingKeys.length) return [{ key: "", rows }];
  const byKey = new Map<string, number[]>();
  for (const i of rows) {
    const key = ctx.groupingKeyForRow(i);
    if (key === null) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(i);
    else byKey.set(key, [i]);
  }
  return ctx.groupingKeys
    .filter((key) => byKey.has(key))
    .map((key) => ({ key, rows: byKey.get(key)! }));
}

/**
 * Constancy theorem for projection color (I2, one law with curves): the channel
 * encoding when the channel variable is constant within `rows`; endpoint palette
 * for endpoint-scoped rows; neutral otherwise.
 */
export function colorForGroup(
  ctx: SelectionProjectionCtx,
  gid: string,
  rows: number[],
  colorOverride?: string
): string {
  if (colorOverride) return colorOverride;
  const { dose, suffix } = parseGid(gid);
  if (suffix && ctx.knownEndpointIds.includes(suffix)) return ctx.colorForEndpoint(suffix);
  const color = ctx.spec?.color;
  if (!color) return ctx.colorForDose(dose);
  if (color.kind === "variable") {
    const level = constantValue(rows, (i) => ctx.levelForRow(i));
    return level ? ctx.colorForLevel(level) : ctx.neutralColor;
  }
  if (color.kind === "dose") return ctx.colorForDose(dose);
  return ctx.neutralColor;
}

function constantValue(rows: number[], valueOf: (rowIndex: number) => string | null): string {
  let seen: string | null = null;
  for (const i of rows) {
    const v = valueOf(i);
    if (v === null || v === undefined) return "";
    if (seen === null) seen = v;
    else if (seen !== v) return "";
  }
  return seen ?? "";
}

/**
 * Readout label: the clicked row, refined by the group key — but only by the
 * PARTS that add information. A composite key repeats the dose (grouping by
 * dose) or the channel level (grouping by the color variable); those parts are
 * already in the row's identity and are dropped ("2400 mg · 1 · 2400 mg" was
 * the QA-flagged redundancy).
 */
export function selectionGroupLabel(
  ctx: Pick<SelectionProjectionCtx, "knownEndpointIds">,
  gid: string,
  curveKey: string
): string {
  const { dose, suffix } = parseGid(gid);
  const suffixIsEndpoint = !!suffix && ctx.knownEndpointIds.includes(suffix);
  const base = suffix && !suffixIsEndpoint ? `${dose} · ${suffix}` : dose;
  if (!curveKey) return base;
  const fresh = curveKey
    .split(GROUP_KEY_SEPARATOR)
    .filter((part) => part !== dose && part !== suffix);
  if (!fresh.length) return base;
  return `${base}${GROUP_KEY_SEPARATOR}${fresh.join(GROUP_KEY_SEPARATOR)}`;
}

/**
 * The full pipeline for one panel: selection → rows per clicked group →
 * grouping partitions (curve granularity, I8) → endpoint-finite rows →
 * exposure quantiles + family observed summary + constancy color.
 */
export function projectedSelectionGroups(
  ctx: SelectionProjectionCtx,
  endpointId: string,
  family: EndpointFamilyAdapter<never>,
  cohortRowIndices?: number[],
  colorOverride?: string
): ProjectedSelectionGroup[] {
  const out: ProjectedSelectionGroup[] = [];
  for (const gid of selectionGids(ctx, endpointId)) {
    const groupRows = rowsForGroup(ctx, gid, endpointId, cohortRowIndices).filter((i) =>
      Number.isFinite(ctx.endpointValue(i, endpointId))
    );
    for (const part of partitionSelectionByGrouping(ctx, groupRows)) {
      const vals = part.rows
        .map((i) => ctx.exposureValue(i))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
      const s = ctx.summarizeExposures(vals);
      if (!s) continue;
      const summary = family.observedSummary(part.rows.map((i) => ctx.endpointValue(i, endpointId)));
      out.push({
        groupId: gid,
        curveKey: part.key,
        label: selectionGroupLabel(ctx, gid, part.key),
        color: colorForGroup(ctx, gid, part.rows, colorOverride),
        ...s,
        n: vals.length,
        observedSummary: ctx.showObservedSummary ? summary ?? undefined : undefined
      });
    }
  }
  return out;
}
