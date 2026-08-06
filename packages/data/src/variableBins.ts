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

function numericValuesForRows(loaded: LoadedDataset, variableId: string, rowIndices: number[]): number[] {
  const col = getColumn(loaded, variableId);
  const out: number[] = [];
  for (const i of rowIndices) {
    const n = Number(col[i]);
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

export interface VariableLevelModel {
  binning?: VariableColorBinning;
  levels: string[];
  cuts?: number[];
}

export function buildVariableLevelModel(
  loaded: LoadedDataset,
  variableId: string,
  rowIndices: number[],
  binning?: VariableColorBinning
): VariableLevelModel {
  const effective = effectiveVariableBinning(loaded, variableId, rowIndices, binning);
  if (effective) {
    const vals = numericValuesForRows(loaded, variableId, rowIndices).sort((a, b) => a - b);
    const cuts = cutpointsFor(effective, vals);
    return { binning: effective, levels: binLabelsFor(effective), cuts };
  }
  const col = getColumn(loaded, variableId);
  const set = new Set<string>();
  for (const i of rowIndices) {
    const raw = col[i];
    if (raw === null || raw === undefined) continue;
    set.add(String(raw).trim());
  }
  const levels = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { levels };
}

export function levelForRow(
  i: number,
  model: VariableLevelModel,
  loaded: LoadedDataset,
  variableId: string
): string {
  const col = getColumn(loaded, variableId);
  const raw = col[i];
  if (raw === null || raw === undefined) return "";
  if (model.binning && model.cuts) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "";
    const idx = binIndex(n, model.cuts);
    return model.levels[idx] ?? model.levels[model.levels.length - 1] ?? "";
  }
  return String(raw).trim();
}
