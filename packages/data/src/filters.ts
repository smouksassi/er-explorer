import type { Filter } from "@er-explorer/domain";
import { getColumn, type LoadedDataset } from "./loadedDataset";
import { isMissing, type RawCellValue } from "./rawValue";
import { toNumeric } from "./typeInference";

function valuesEqual(observed: RawCellValue, target: string | number): boolean {
  const observedNumeric = toNumeric(observed);
  const targetNumeric = typeof target === "number" ? target : toNumeric(target);
  if (observedNumeric !== undefined && targetNumeric !== undefined) {
    return observedNumeric === targetNumeric;
  }
  return String(observed).trim() === String(target).trim();
}

function compareOrdered(observed: RawCellValue, target: string | number): number {
  const observedNumeric = toNumeric(observed);
  const targetNumeric = typeof target === "number" ? target : toNumeric(target);
  if (observedNumeric !== undefined && targetNumeric !== undefined) {
    return observedNumeric < targetNumeric ? -1 : observedNumeric > targetNumeric ? 1 : 0;
  }
  const observedText = String(observed);
  const targetText = String(target);
  return observedText < targetText ? -1 : observedText > targetText ? 1 : 0;
}

/**
 * Evaluate a single `@er-explorer/domain` {@link Filter} against one row of
 * a {@link LoadedDataset}, by variable id and row index.
 *
 * A missing observation never matches any filter (there is nothing to
 * compare), regardless of operator - consistent with how filters are
 * described in `@er-explorer/domain`: population-narrowing constraints,
 * not missing-data imputation rules.
 */
export function matchesFilter(loaded: LoadedDataset, recordIndex: number, filter: Filter): boolean {
  const observed = getColumn(loaded, filter.variableId)[recordIndex];
  if (isMissing(observed)) return false;

  switch (filter.operator) {
    case "=":
      return valuesEqual(observed, filter.value as string | number);
    case "!=":
      return !valuesEqual(observed, filter.value as string | number);
    case "<":
      return compareOrdered(observed, filter.value as string | number) < 0;
    case "<=":
      return compareOrdered(observed, filter.value as string | number) <= 0;
    case ">":
      return compareOrdered(observed, filter.value as string | number) > 0;
    case ">=":
      return compareOrdered(observed, filter.value as string | number) >= 0;
    case "in":
      return (filter.value as Array<string | number>).some((candidate) => valuesEqual(observed, candidate));
    case "not-in":
      return !(filter.value as Array<string | number>).some((candidate) => valuesEqual(observed, candidate));
    case "between": {
      const [low, high] = filter.value as Array<string | number>;
      return compareOrdered(observed, low) >= 0 && compareOrdered(observed, high) <= 0;
    }
    default:
      return true;
  }
}

/**
 * Lazily yield the row indices of `loaded` that pass every filter in
 * `filters` (logical AND, per `@er-explorer/domain`'s `Filter` docs).
 *
 * A generator rather than a materialized array: consuming this only reads
 * `loaded`'s existing columns row by row, it never builds a filtered copy
 * of the dataset. Every query in this package (`queryLongView`,
 * `queryWideView`) is built on top of this same lazy pass.
 */
export function* selectRecordIndices(loaded: LoadedDataset, filters: ReadonlyArray<Filter> = []): IterableIterator<number> {
  for (let recordIndex = 0; recordIndex < loaded.rowCount; recordIndex++) {
    let matchesAll = true;
    for (const filter of filters) {
      if (!matchesFilter(loaded, recordIndex, filter)) {
        matchesAll = false;
        break;
      }
    }
    if (matchesAll) yield recordIndex;
  }
}

/** Count how many rows pass `filters`, without materializing the matching index list. */
export function countMatchingRecords(loaded: LoadedDataset, filters: ReadonlyArray<Filter> = []): number {
  let count = 0;
  for (const _ of selectRecordIndices(loaded, filters)) count++;
  return count;
}
