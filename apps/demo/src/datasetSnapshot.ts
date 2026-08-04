import type { LoadedDataset, RawCellValue } from "@er-explorer/data";
import { getColumn } from "@er-explorer/data";
import { computeChecksum } from "@er-explorer/session-engine";
import type { DemoColumnRole } from "./columnMapping";

/** JSON-serializable wide snapshot for legacy demo sessions. */
export interface DatasetSnapshot {
  variableOrder: string[];
  columns: Record<string, RawCellValue[]>;
  rowCount: number;
}

export interface ByodSessionPayload {
  columnRoles: Record<string, DemoColumnRole>;
  snapshot: DatasetSnapshot;
  snapshotChecksum: string;
  datasetName?: string;
}

export function snapshotFromLoaded(loaded: LoadedDataset): DatasetSnapshot {
  const columns: Record<string, RawCellValue[]> = {};
  for (const id of loaded.variableOrder) {
    columns[id] = [...getColumn(loaded, id)];
  }
  return {
    variableOrder: [...loaded.variableOrder],
    columns,
    rowCount: loaded.rowCount
  };
}

export function checksumSnapshot(snapshot: DatasetSnapshot): string {
  return computeChecksum(snapshot);
}

export function buildByodPayload(loaded: LoadedDataset, columnRoles: Record<string, DemoColumnRole>, datasetName?: string): ByodSessionPayload {
  const snapshot = snapshotFromLoaded(loaded);
  return {
    columnRoles: { ...columnRoles },
    snapshot,
    snapshotChecksum: checksumSnapshot(snapshot),
    datasetName
  };
}

export function verifySnapshotChecksum(snapshot: DatasetSnapshot, expected: string): boolean {
  return checksumSnapshot(snapshot) === expected;
}
