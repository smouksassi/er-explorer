import {
  type BuiltStudyDataset,
  type InferredVariable,
  type LoadedDataset,
  type RawCellValue,
  buildStudyDataset,
  getColumn,
  inferVariableMetadata,
  isMissing,
  loadDataset
} from "@er-explorer/data";
import type { StudyDataset } from "@er-explorer/domain";
import {
  type DemoColumnRole,
  EFFICGI_DEFAULT_ROLES,
  guessColumnRole,
  roleHintForDemoRole,
  validateColumnMapping
} from "./columnMapping";
import { type DatasetSnapshot, snapshotFromLoaded } from "./datasetSnapshot";
import type { ExposureResponseRecord } from "./data.generated";

export type MetricId = string;
export type EndpointId = string;

const DOSE_PALETTE = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f"];

export const DEFAULT_EXPOSURE_ORDER: MetricId[] = ["auc", "cmax"];
export const DEFAULT_ENDPOINT_ORDER: EndpointId[] = ["icgi", "icgi7", "icgi2", "icgi3", "brls", "prls"];

const LEGACY_CONTINUOUS_ENDPOINTS = new Set<string>(["brls", "prls"]);

const DOSE_COLORS_LEGACY: Record<string, string> = {
  Placebo: "#1f77b4",
  "600 mg": "#ff7f0e",
  "1200 mg": "#2ca02c",
  "1800 mg": "#d62728",
  "2400 mg": "#9467bd"
};

export class DatasetContext {
  readonly loaded: LoadedDataset;
  readonly study: StudyDataset;
  readonly inferred: Record<string, InferredVariable>;
  readonly columnRoles: Record<string, DemoColumnRole>;
  readonly datasetId: string;
  readonly datasetName: string;

  private readonly identifierColumn: string;
  private readonly doseColumn: string;
  private readonly exposureColumns: MetricId[];
  private readonly endpointColumns: EndpointId[];
  private readonly doseOrderCache: string[];
  private readonly doseColors: Record<string, string>;

  private constructor(
    built: BuiltStudyDataset,
    loaded: LoadedDataset,
    columnRoles: Record<string, DemoColumnRole>,
    meta: { datasetId: string; datasetName: string }
  ) {
    this.loaded = loaded;
    this.study = built.dataset;
    this.inferred = built.inferred;
    this.columnRoles = columnRoles;
    this.datasetId = meta.datasetId;
    this.datasetName = meta.datasetName;

    this.identifierColumn = pickSingleColumn(columnRoles, "identifier");
    this.doseColumn = pickSingleColumn(columnRoles, "dose");
    this.exposureColumns = columnsWithRole(columnRoles, "exposure");
    this.endpointColumns = columnsWithRole(columnRoles, "endpoint");

    const doses = new Set<string>();
    for (let i = 0; i < loaded.rowCount; i++) {
      doses.add(this.doseLabel(i));
    }
    this.doseOrderCache = sortDoseLabels([...doses]);
    this.doseColors = {};
    this.doseOrderCache.forEach((d, idx) => {
      this.doseColors[d] = DOSE_COLORS_LEGACY[d] ?? DOSE_PALETTE[idx % DOSE_PALETTE.length];
    });
  }

  static bundledRowsFromRecords(records: ExposureResponseRecord[]): Array<Record<string, RawCellValue>> {
    return records.map((r) => ({
      id: r.id,
      study: r.study,
      dose: r.dose,
      doseNumeric: r.doseNumeric,
      sex: r.sex,
      age: r.age,
      wt: r.wt,
      race: r.race,
      crcl: r.crcl,
      gbds: r.gbds,
      auc: r.auc,
      cmax: r.cmax,
      icgi: r.icgi,
      icgi7: r.icgi7,
      icgi2: r.icgi2,
      icgi3: r.icgi3,
      brls: r.brls,
      prls: r.prls
    }));
  }

  static fromRecords(records: ExposureResponseRecord[], datasetId = "effICGI-demo-v1"): DatasetContext {
    return DatasetContext.fromRows(
      DatasetContext.bundledRowsFromRecords(records),
      EFFICGI_DEFAULT_ROLES,
      { datasetId, datasetName: "Bundled effICGI" }
    );
  }

  static fromRows(
    rows: Array<Record<string, RawCellValue>>,
    columnRoles: Record<string, DemoColumnRole>,
    meta: { datasetId: string; datasetName: string }
  ): DatasetContext {
    const validation = validateColumnMapping(columnRoles);
    if (!validation.ok) {
      throw new Error(validation.errors.join(" "));
    }
    const loaded = loadDataset(rows);
    const roleHints: Record<string, import("@er-explorer/data").VariableRoleHint> = {};
    for (const [col, role] of Object.entries(columnRoles)) {
      const hint = roleHintForDemoRole(role);
      if (hint) roleHints[col] = hint;
    }
    const built = buildStudyDataset({
      id: meta.datasetId,
      name: meta.datasetName,
      loaded,
      provenance: {
        source: meta.datasetName,
        generatedAt: new Date().toISOString()
      },
      roleHints
    });
    return new DatasetContext(built, loaded, columnRoles, meta);
  }

  static fromSnapshot(
    snapshot: DatasetSnapshot,
    columnRoles: Record<string, DemoColumnRole>,
    meta: { datasetId: string; datasetName: string }
  ): DatasetContext {
    const columns = new Map<string, ReadonlyArray<RawCellValue>>();
    for (const id of snapshot.variableOrder) {
      columns.set(id, Object.freeze([...(snapshot.columns[id] ?? [])]));
    }
    const loaded = loadDataset(columns);
    return DatasetContext.fromRows(rowsFromLoaded(loaded), columnRoles, meta);
  }

  get rowCount(): number {
    return this.loaded.rowCount;
  }

  exposureOrder(): MetricId[] {
    return [...this.exposureColumns];
  }

  endpointOrder(): EndpointId[] {
    return [...this.endpointColumns];
  }

  doseOrder(): string[] {
    return [...this.doseOrderCache];
  }

  doseColor(dose: string): string {
    return this.doseColors[dose] ?? "#64748b";
  }

  patientId(rowIndex: number): number {
    const raw = getColumn(this.loaded, this.identifierColumn)[rowIndex];
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : rowIndex;
  }

  doseLabel(rowIndex: number): string {
    const raw = getColumn(this.loaded, this.doseColumn)[rowIndex];
    if (raw === null || raw === undefined) return "Unknown";
    return String(raw);
  }

  exposureValue(rowIndex: number, metric: MetricId): number {
    const raw = getColumn(this.loaded, metric)[rowIndex];
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  endpointValue(rowIndex: number, endpoint: EndpointId): number {
    const raw = getColumn(this.loaded, endpoint)[rowIndex];
    if (isMissing(raw)) return NaN;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  exposureLabel(metric: MetricId): string {
    const v = this.inferred[metric];
    return (v?.label ?? metric).toUpperCase();
  }

  endpointLabel(endpoint: EndpointId): string {
    const v = this.inferred[endpoint];
    return v?.label ?? endpoint.toUpperCase();
  }

  isContinuousEndpoint(endpoint: EndpointId): boolean {
    if (LEGACY_CONTINUOUS_ENDPOINTS.has(endpoint)) return true;
    const v = this.inferred[endpoint];
    return v?.type === "continuous";
  }

  rowIndicesWithEndpoint(endpoint: EndpointId): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.rowCount; i++) {
      if (Number.isFinite(this.endpointValue(i, endpoint))) out.push(i);
    }
    return out;
  }

  allRowIndices(): number[] {
    return Array.from({ length: this.rowCount }, (_, i) => i);
  }

  isPlaceboDose(dose: string): boolean {
    const lower = dose.toLowerCase().trim();
    if (lower === "placebo" || lower === "0" || lower === "control") return true;
    if (lower.includes("placebo") || lower.includes("standard of care") || lower === "soc") return true;
    return dose === "Placebo";
  }

  /** Optional study/pool id for tooltips (covariate column named study, else first covariate). */
  studyLabel(rowIndex: number): string {
    const covariates = columnsWithRole(this.columnRoles, "covariate");
    const studyCol = covariates.find((c) => c.toLowerCase() === "study") ?? covariates[0];
    if (!studyCol) return "";
    const raw = getColumn(this.loaded, studyCol)[rowIndex];
    return raw === null || raw === undefined ? "" : String(raw);
  }

  covariateColumnIds(): string[] {
    return columnsWithRole(this.columnRoles, "covariate");
  }

  /** `columnId: value` strings for scatter hover — every mapped covariate, including explicit missing. */
  covariateHoverParts(rowIndex: number): string[] {
    return this.covariateColumnIds().map((col) => {
      const raw = getColumn(this.loaded, col)[rowIndex];
      if (isMissing(raw)) return `${col}: missing`;
      const text = typeof raw === "number" ? (Number.isInteger(raw) ? String(raw) : raw.toFixed(2)) : String(raw).trim();
      return `${col}: ${text || "missing"}`;
    });
  }

  toSnapshot(): DatasetSnapshot {
    return snapshotFromLoaded(this.loaded);
  }
}

function pickSingleColumn(roles: Record<string, DemoColumnRole>, role: DemoColumnRole): string {
  const cols = columnsWithRole(roles, role);
  if (!cols.length) throw new Error(`Missing column mapped as ${role}`);
  return cols[0];
}

function columnsWithRole(roles: Record<string, DemoColumnRole>, role: DemoColumnRole): string[] {
  return Object.entries(roles)
    .filter(([, r]) => r === role)
    .map(([id]) => id);
}

function sortDoseLabels(doses: string[]): string[] {
  const placebo = doses.filter((d) => d === "Placebo" || d.toLowerCase() === "placebo");
  const rest = doses.filter((d) => !placebo.includes(d));
  rest.sort((a, b) => {
    const na = parseDoseNumeric(a);
    const nb = parseDoseNumeric(b);
    if (na !== null && nb !== null) return na - nb;
    return a.localeCompare(b);
  });
  return [...placebo, ...rest];
}

function parseDoseNumeric(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Row objects for the mapping UI (re-apply roles without re-uploading CSV). */
export function rowsFromLoaded(loaded: LoadedDataset): Array<Record<string, RawCellValue>> {
  const rows: Array<Record<string, RawCellValue>> = [];
  for (let i = 0; i < loaded.rowCount; i++) {
    const row: Record<string, RawCellValue> = {};
    for (const id of loaded.variableOrder) {
      row[id] = getColumn(loaded, id)[i];
    }
    rows.push(row);
  }
  return rows;
}

export function inferRolesForColumns(
  loaded: LoadedDataset,
  current: Record<string, DemoColumnRole>
): Record<string, DemoColumnRole> {
  const roles = { ...current };
  for (const id of loaded.variableOrder) {
    if (roles[id]) continue;
    const values = getColumn(loaded, id);
    const meta = inferVariableMetadata(id, values);
    roles[id] = guessColumnRole(id, meta.distinctCount);
  }
  return roles;
}

export function buildPendingContext(
  rows: Array<Record<string, RawCellValue>>,
  columnRoles: Record<string, DemoColumnRole>
): { loaded: LoadedDataset; inferred: Record<string, InferredVariable> } {
  const loaded = loadDataset(rows);
  const inferred: Record<string, InferredVariable> = {};
  for (const id of loaded.variableOrder) {
    inferred[id] = inferVariableMetadata(id, getColumn(loaded, id), {
      roleHint: roleHintForDemoRole(columnRoles[id] ?? "ignore")
    });
  }
  return { loaded, inferred };
}
