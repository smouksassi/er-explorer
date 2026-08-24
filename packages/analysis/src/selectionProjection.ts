/**
 * The selection → projection pipeline (ADR-0012/0013, invariants I1–I4, I8).
 *
 * ONE implementation for every model family: which rows a clicked dist group
 * means (dose ∩ level/endpoint ∩ panel cohort), which curve-granularity groups a
 * selection resolves to (I8 expansion), what color a group wears (one-channel
 * law), and the exposure-quantile + observed-summary stats a projection carries.
 *
 * Dataset access, palettes, and the family adapter are INJECTED — this module
 * imports domain types only, so the unit-level conformance matrix can execute it
 * directly per family with no DOM and no dataset machinery.
 */

import type { EndpointFamilyAdapter, ObservedGroupSummary, ViewLayoutSpec } from "@er-explorer/domain";

/** Structural subset of the demo's ColorBinModel the pipeline needs. */
export interface SelectionLevelModel {
  levels: string[];
}

/** Exposure five-number summary; producer injected (summarizeDistribution). */
export interface ExposureSummary {
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
  rowIndicesForDose(dose: string): number[];
  /** Active-set membership for a row (brush/filter), by row index. */
  isActiveRow(rowIndex: number): boolean;
  /** Exposure value for the metric under projection. */
  exposureValue(rowIndex: number): number;
  endpointValue(rowIndex: number, endpointId: string): number;
  /** Color-variable level of a row under the base-cohort model; null = missing or no channel. */
  levelForRow(rowIndex: number): string | null;
  summarizeExposures(sortedFiniteValues: number[]): ExposureSummary | null;
  colorForLevel(level: string): string;
  colorForEndpoint(endpointId: string): string;
  colorForDose(dose: string): string;
  neutralColor: string;
}

/** One projected group at curve granularity — family-agnostic. */
export interface ProjectedSelectionGroup extends ExposureSummary {
  groupId: string;
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

/**
 * I8 — granularity rule: with per-level curves (explicit grouping / legacy
 * fitByColor on a covariate channel), pooled dose selections expand to
 * dose×level groups; a pooled window never rides a level curve.
 */
export function gidsAtCurveGranularity(ctx: SelectionProjectionCtx, gids: string[]): string[] {
  const spec = ctx.spec;
  const splitCurves =
    !!spec?.fitByColor && spec.color.kind === "variable" && !!ctx.colorModel && ctx.colorModel.levels.length > 1;
  if (!splitCurves) return gids;
  const levels = ctx.colorModel!.levels;
  return [
    ...new Set(
      gids.flatMap((gid) => {
        const { dose, suffix } = parseGid(gid);
        if (suffix && !ctx.knownEndpointIds.includes(suffix)) return [gid];
        return levels.map((level) => `${dose}|${level}`);
      })
    )
  ];
}

/** Rows a dist group id means: dose ∩ active ∩ panel cohort ∩ (level | endpoint-finite) — I3. */
export function rowsForGroup(
  ctx: SelectionProjectionCtx,
  gid: string,
  endpointId: string,
  cohortRowIndices?: number[]
): number[] {
  const { dose, suffix } = parseGid(gid);
  const cohortSet = cohortRowIndices ? new Set(cohortRowIndices) : null;
  const rows = ctx
    .rowIndicesForDose(dose)
    .filter((i) => ctx.isActiveRow(i) && (!cohortSet || cohortSet.has(i)));
  if (!suffix) return rows;
  if (ctx.knownEndpointIds.includes(suffix)) {
    return rows.filter((i) => Number.isFinite(ctx.endpointValue(i, suffix)));
  }
  return rows.filter((i) => ctx.levelForRow(i) === suffix);
}

/** One-channel law for a group's color (I2): level palette for level rows,
 * endpoint palette for endpoint rows, dose palette ONLY when color IS dose,
 * neutral otherwise. */
export function colorForGroup(
  ctx: SelectionProjectionCtx,
  gid: string,
  colorOverride?: string
): string {
  const { dose, suffix } = parseGid(gid);
  if (colorOverride) return colorOverride;
  if (suffix && ctx.spec?.color.kind === "variable" && ctx.colorModel) {
    return ctx.colorForLevel(suffix);
  }
  if (suffix && ctx.knownEndpointIds.includes(suffix)) return ctx.colorForEndpoint(suffix);
  if (ctx.spec && ctx.spec.color.kind !== "dose") return ctx.neutralColor;
  return ctx.colorForDose(dose);
}

/**
 * The full pipeline for one panel: selection → curve-granularity groups →
 * endpoint-finite rows → exposure quantiles + family observed summary + color.
 */
export function projectedSelectionGroups(
  ctx: SelectionProjectionCtx,
  endpointId: string,
  family: EndpointFamilyAdapter<never>,
  cohortRowIndices?: number[],
  colorOverride?: string
): ProjectedSelectionGroup[] {
  const gids = gidsAtCurveGranularity(ctx, selectionGids(ctx, endpointId));
  const out: ProjectedSelectionGroup[] = [];
  for (const gid of gids) {
    const rows = rowsForGroup(ctx, gid, endpointId, cohortRowIndices).filter((i) =>
      Number.isFinite(ctx.endpointValue(i, endpointId))
    );
    const vals = rows
      .map((i) => ctx.exposureValue(i))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    const s = ctx.summarizeExposures(vals);
    if (!s) continue;
    const summary = family.observedSummary(rows.map((i) => ctx.endpointValue(i, endpointId)));
    out.push({
      groupId: gid,
      color: colorForGroup(ctx, gid, colorOverride),
      ...s,
      n: vals.length,
      observedSummary: ctx.showObservedSummary ? summary ?? undefined : undefined
    });
  }
  return out;
}
