import type { RawCellValue } from "./rawValue";

/**
 * The uploaded dataset, held in memory exactly as ER Explorer's
 * architecture requires: canonical and wide (one entry per column per row,
 * `docs/ARCHITECTURE.md`'s "wide datasets are canonical"), loaded once, and
 * never mutated afterward.
 *
 * Storage is column-oriented (`columns: variable id -> every row's value`)
 * rather than row-oriented, because every operation this package performs
 * - type inference, missing-value summaries, building a derived view for
 * one exposure metric at a time - reads one column across all rows, not
 * one row across all columns. `loadDataset` freezes both the outer map and
 * every column array, so no code anywhere in the engine (or a caller
 * holding a reference to a `LoadedDataset`) can mutate it in place; every
 * operation in this package that needs a different view of the data
 * produces a *new*, separate value rather than editing this one.
 */
export interface LoadedDataset {
  /** Every column's raw values, indexed by variable id, in row order. Frozen; never mutated after `loadDataset` returns. */
  readonly columns: ReadonlyMap<string, ReadonlyArray<RawCellValue>>;
  /** Number of rows (analysis units) in the dataset. */
  readonly rowCount: number;
  /** Variable ids in their original column order, for stable iteration/display order independent of `Map` insertion quirks. */
  readonly variableOrder: ReadonlyArray<string>;
}

/**
 * Load a wide dataset from either row-oriented records (one object per
 * subject, keyed by variable id/column name - the shape a CSV parser
 * typically produces) or an already column-oriented map.
 *
 * Every column is copied into a fresh, frozen array and the resulting
 * `columns` map is itself frozen, so the returned `LoadedDataset` is fully
 * independent of (and immune to later mutation of) whatever the caller
 * passed in - "the uploaded dataset always remains in wide format" and is
 * never mutated holds from this point on, for the lifetime of the
 * `LoadedDataset`.
 */
export function loadDataset(input: Array<Record<string, RawCellValue>> | ReadonlyMap<string, ReadonlyArray<RawCellValue>>): LoadedDataset {
  if (Array.isArray(input)) {
    return loadFromRows(input);
  }
  return loadFromColumns(input);
}

function loadFromRows(rows: Array<Record<string, RawCellValue>>): LoadedDataset {
  const variableOrder: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        variableOrder.push(key);
      }
    }
  }

  const columns = new Map<string, ReadonlyArray<RawCellValue>>();
  for (const key of variableOrder) {
    const values: RawCellValue[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      values[i] = rows[i][key] ?? null;
    }
    columns.set(key, Object.freeze(values));
  }

  return Object.freeze({
    columns: Object.freeze(columns) as ReadonlyMap<string, ReadonlyArray<RawCellValue>>,
    rowCount: rows.length,
    variableOrder: Object.freeze([...variableOrder])
  });
}

function loadFromColumns(input: ReadonlyMap<string, ReadonlyArray<RawCellValue>>): LoadedDataset {
  const variableOrder = [...input.keys()];
  const rowCount = variableOrder.length > 0 ? input.get(variableOrder[0])!.length : 0;

  const columns = new Map<string, ReadonlyArray<RawCellValue>>();
  for (const key of variableOrder) {
    const source = input.get(key)!;
    if (source.length !== rowCount) {
      throw new RangeError(`Column "${key}" has ${source.length} rows; expected ${rowCount} (all columns must have the same length).`);
    }
    columns.set(key, Object.freeze([...source]));
  }

  return Object.freeze({
    columns: Object.freeze(columns) as ReadonlyMap<string, ReadonlyArray<RawCellValue>>,
    rowCount,
    variableOrder: Object.freeze(variableOrder)
  });
}

/** Read one column's values by variable id, or an empty array if the column doesn't exist - a small convenience over `dataset.columns.get(id)` that never returns `undefined`. */
export function getColumn(dataset: LoadedDataset, variableId: string): ReadonlyArray<RawCellValue> {
  return dataset.columns.get(variableId) ?? [];
}
