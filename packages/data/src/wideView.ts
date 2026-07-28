import type { Filter } from "@er-explorer/domain";
import { countMatchingRecords, selectRecordIndices } from "./filters";
import { getColumn, type LoadedDataset } from "./loadedDataset";
import type { RawCellValue } from "./rawValue";
import { type AnalysisView, createAnalysisView } from "./views";

/** One row of a wide derived view: the requested columns for a single record, still one row per subject. */
export type WideViewRow = { recordIndex: number } & Record<string, RawCellValue>;

export interface WideViewQuery {
  /** Which columns to project. Order is preserved for display purposes; unrequested columns are simply absent from each row. */
  variableIds: string[];
  /** Population-narrowing constraints (see `@er-explorer/domain`'s `Filter`). */
  filters?: Filter[];
}

/**
 * Project a subset of columns from the canonical wide dataset into
 * row-oriented records - "wide in, wide out", for callers that want normal
 * one-row-per-subject data (e.g. a data table view, or exporting a subset)
 * rather than {@link queryLongView}'s tidy/faceted shape.
 *
 * Lazy and non-copying in the same way as `queryLongView`: rows are
 * assembled only on iteration, directly from `loaded`'s columns.
 */
export function queryWideView(loaded: LoadedDataset, query: WideViewQuery): AnalysisView<WideViewRow> {
  const filters = query.filters ?? [];

  function* rows(): IterableIterator<WideViewRow> {
    for (const recordIndex of selectRecordIndices(loaded, filters)) {
      const row: WideViewRow = { recordIndex };
      for (const variableId of query.variableIds) {
        row[variableId] = getColumn(loaded, variableId)[recordIndex] ?? null;
      }
      yield row;
    }
  }

  return createAnalysisView(rows, () => countMatchingRecords(loaded, filters));
}
