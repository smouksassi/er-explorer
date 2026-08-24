import type { VariableColorBinning } from "@er-explorer/domain";
import { getColumn, type LoadedDataset } from "./loadedDataset";

const CONTINUOUS_DISTINCT_THRESHOLD = 15;

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  const hi = sorted[base + 1];
  if (hi !== undefined) return sorted[base]! + rest * (hi - sorted[base]!);
  return sorted[base]!;
}

export function isNumericCovariateColumn(loaded: LoadedDataset, variableId: string, rowIndices: number[]): boolean {
  const col = getColumn(loaded, variableId);
  let numeric = 0;
  let total = 0;
  const distinct = new Set<string>();
  for (const i of rowIndices) {
    const raw = col[i];
    if (raw === null || raw === undefined || raw === "") continue;
    total++;
    distinct.add(String(raw).trim());
    const n = Number(raw);
    if (Number.isFinite(n)) numeric++;
  }
  if (total === 0) return false;
  if (numeric / total < 0.95) return false;
  return distinct.size > CONTINUOUS_DISTINCT_THRESHOLD;
}

export function effectiveVariableBinning(
  loaded: LoadedDataset,
  variableId: string,
  rowIndices: number[],
  binning: VariableColorBinning | undefined
): VariableColorBinning | undefined {
  if (!isNumericCovariateColumn(loaded, variableId, rowIndices)) return undefined;
  return binning ?? "median";
}

/** @deprecated cut-value-bearing labels (binLabelsForCuts) replaced the opaque
 * "≤ median" labels — the user could not verify which cut was used (QA round 13). */
export function binLabelsFor(binning: VariableColorBinning): string[] {
  switch (binning) {
    case "median":
      return ["≤ median", "> median"];
    case "tertiles":
      return ["T1 (low)", "T2 (mid)", "T3 (high)"];
    case "quartiles":
      return ["Q1 (low)", "Q2", "Q3", "Q4 (high)"];
  }
}

/** One decimal keeps the cut faithful (105.5 must not display as 106 — a row at
 * 105.8 would read as inside "≤ 106" while being above the real cut). */
function fmtCut(v: number): string {
  return v.toFixed(1).replace(/\.0$/, "");
}

/** Transparent bin labels carrying the actual cut values ("≤ 105.5", "92.7–119.2",
 * "> 119.2") so the binning is verifiable against external tools. */
export function binLabelsForCuts(cuts: number[]): string[] {
  if (!cuts.length) return [];
  const labels: string[] = [`≤ ${fmtCut(cuts[0]!)}`];
  for (let i = 1; i < cuts.length; i++) labels.push(`${fmtCut(cuts[i - 1]!)}–${fmtCut(cuts[i]!)}`);
  labels.push(`> ${fmtCut(cuts[cuts.length - 1]!)}`);
  return labels;
}

function numericValuesForRows(loaded: LoadedDataset, variableId: string, rowIndices: number[]): number[] {
  const col = getColumn(loaded, variableId);
  const out: number[] = [];
  for (const i of rowIndices) {
    const raw = col[i];
    // Missing stays missing: Number(null) and Number("") are 0, which silently
    // dragged every cut point toward zero (crcl "median" 92.5 vs true 105.5 with
    // 25% missingness — caught by the user's R cross-check, QA round 13).
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function cutpointsFor(binning: VariableColorBinning, sorted: number[]): number[] {
  if (!sorted.length) return [];
  if (binning === "median") return [quantile(sorted, 0.5)];
  if (binning === "tertiles") return [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
  return [quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)];
}

function binIndex(value: number, cuts: number[]): number {
  let b = 0;
  while (b < cuts.length && value > cuts[b]!) b++;
  return b;
}

/**
 * The explicit missing level (user ruling, QA round 12): rows with a missing
 * covariate value form a first-class level — facet panel, strip sub-row, color
 * level, curve group — never silently dropped (25% of the demo cohort was
 * vanishing from crcl views). Reserved gray ink everywhere; ordered last.
 */
export const MISSING_LEVEL = "(missing)";

export interface VariableLevelModel {
  binning?: VariableColorBinning;
  levels: string[];
  cuts?: number[];
  /** True when `levels` ends with {@link MISSING_LEVEL}. */
  hasMissing?: boolean;
}

function isMissingRaw(raw: unknown): boolean {
  return raw === null || raw === undefined || String(raw).trim() === "";
}

export function buildVariableLevelModel(
  loaded: LoadedDataset,
  variableId: string,
  rowIndices: number[],
  binning?: VariableColorBinning
): VariableLevelModel {
  const col = getColumn(loaded, variableId);
  const hasMissing = rowIndices.some((i) => isMissingRaw(col[i]));
  const effective = effectiveVariableBinning(loaded, variableId, rowIndices, binning);
  if (effective) {
    const vals = numericValuesForRows(loaded, variableId, rowIndices).sort((a, b) => a - b);
    const cuts = cutpointsFor(effective, vals);
    const levels = binLabelsForCuts(cuts);
    if (hasMissing) levels.push(MISSING_LEVEL);
    return { binning: effective, levels, cuts, hasMissing };
  }
  const set = new Set<string>();
  for (const i of rowIndices) {
    const raw = col[i];
    if (isMissingRaw(raw)) continue;
    set.add(String(raw).trim());
  }
  const levels = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (hasMissing) levels.push(MISSING_LEVEL);
  return { levels, hasMissing };
}

export function levelForRow(
  i: number,
  model: VariableLevelModel,
  loaded: LoadedDataset,
  variableId: string
): string {
  const col = getColumn(loaded, variableId);
  const raw = col[i];
  if (isMissingRaw(raw)) return model.hasMissing ? MISSING_LEVEL : "";
  if (model.binning && model.cuts) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return model.hasMissing ? MISSING_LEVEL : "";
    const idx = binIndex(n, model.cuts);
    return model.levels[idx] ?? "";
  }
  return String(raw).trim();
}
