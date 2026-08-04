import { getColumn, isMissing, type RawCellValue } from "@er-explorer/data";
import type { LoadedDataset } from "@er-explorer/data";
import type { DemoColumnRole } from "./columnMapping";

export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "notIn"
  | "lt"
  | "lte"
  | "gt"
  | "gte";

export interface DataFilterRule {
  id: string;
  column: string;
  operator: FilterOperator;
  /** Numeric threshold or categorical values (string form). */
  values: string[];
  /** When true, match string values only (pick from distinct values in UI). */
  categorical?: boolean;
}

export interface FilterColumnOption {
  id: string;
  label: string;
  role: DemoColumnRole;
  numeric: boolean;
}

export function listFilterColumns(
  loaded: LoadedDataset,
  columnRoles: Record<string, DemoColumnRole>,
  labels: Record<string, string>
): FilterColumnOption[] {
  const out: FilterColumnOption[] = [];
  for (const id of loaded.variableOrder) {
    const role = columnRoles[id] ?? "ignore";
    if (role === "ignore" || role === "identifier") continue;
    const inf = labels[id];
    const numeric = inferNumericColumn(loaded, id);
    out.push({ id, label: inf ?? id, role, numeric });
  }
  return out;
}

function inferNumericColumn(loaded: LoadedDataset, columnId: string): boolean {
  const col = getColumn(loaded, columnId);
  let n = 0;
  let numeric = 0;
  for (let i = 0; i < Math.min(col.length, 200); i++) {
    const v = col[i];
    if (isMissing(v)) continue;
    n++;
    if (typeof v === "number" && Number.isFinite(v)) numeric++;
    else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) numeric++;
  }
  return n > 0 && numeric / n > 0.85;
}

export function distinctColumnValues(loaded: LoadedDataset, columnId: string, limit = 80): string[] {
  const col = getColumn(loaded, columnId);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (isMissing(v)) continue;
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function cellString(raw: RawCellValue): string {
  if (isMissing(raw)) return "";
  return String(raw);
}

function cellNumber(raw: RawCellValue): number {
  if (isMissing(raw)) return NaN;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function rowMatchesFilter(rowIndex: number, rule: DataFilterRule, loaded: LoadedDataset): boolean {
  const raw = getColumn(loaded, rule.column)[rowIndex];
  const numeric = rule.categorical ? false : inferNumericColumn(loaded, rule.column);
  const vals = rule.values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (!vals.length) return true;

  if (numeric) {
    const x = cellNumber(raw);
    if (!Number.isFinite(x)) return false;
    const n0 = Number(vals[0]);
    switch (rule.operator) {
      case "lt":
        return x < n0;
      case "lte":
        return x <= n0;
      case "gt":
        return x > n0;
      case "gte":
        return x >= n0;
      case "eq":
        return x === n0;
      case "neq":
        return x !== n0;
      case "in":
        return vals.some((v) => x === Number(v));
      case "notIn":
        return !vals.some((v) => x === Number(v));
      default:
        return true;
    }
  }

  const s = cellString(raw);
  switch (rule.operator) {
    case "eq":
    case "in":
      return vals.includes(s);
    case "neq":
    case "notIn":
      return !vals.includes(s);
    default:
      return true;
  }
}

export function filterOperatorsForColumn(numeric: boolean): { value: FilterOperator; label: string }[] {
  if (numeric) {
    return [
      { value: "lt", label: "less than" },
      { value: "lte", label: "≤" },
      { value: "gt", label: "greater than" },
      { value: "gte", label: "≥" },
      { value: "eq", label: "equals" },
      { value: "neq", label: "not equal" },
      { value: "in", label: "in list" }
    ];
  }
  return [
    { value: "in", label: "is any of" },
    { value: "notIn", label: "is not" },
    { value: "eq", label: "equals" },
    { value: "neq", label: "not equal" }
  ];
}

const OP_SYMBOL: Partial<Record<FilterOperator, string>> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "=",
  neq: "≠"
};

/** Human-readable one-liner for the plot status bar. */
export function describeFilterRule(rule: DataFilterRule, columnLabel: string): string {
  const vals = rule.values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (!vals.length) return "";
  const col = columnLabel || rule.column;
  if (rule.operator === "in") {
    return vals.length === 1 ? `${col} = ${vals[0]}` : `${col} ∈ {${vals.join(", ")}}`;
  }
  if (rule.operator === "notIn") {
    return vals.length === 1 ? `${col} ≠ ${vals[0]}` : `${col} ∉ {${vals.join(", ")}}`;
  }
  const sym = OP_SYMBOL[rule.operator];
  if (sym) return `${col} ${sym} ${vals[0]}`;
  return `${col} ${rule.operator} ${vals.join(", ")}`;
}

export function describeActiveFilters(rules: DataFilterRule[], labelFor: (columnId: string) => string): string {
  const parts = rules.map((r) => describeFilterRule(r, labelFor(r.column))).filter(Boolean);
  return parts.length ? parts.join("; ") : "";
}
