/**
 * A derived analysis view produced by one of this package's queries
 * (`queryLongView`, `queryWideView`).
 *
 * `AnalysisView` is deliberately lazy: constructing one does no work and
 * copies nothing from the underlying {@link LoadedDataset} - it is a
 * recipe, not a result. Rows are computed only when the caller actually
 * iterates (`for...of`, `.rows()`, or the spread operator), and every
 * iteration re-derives them from the original dataset rather than reading
 * back a cached copy, so a view always reflects its query against the one
 * canonical dataset, never a stale snapshot.
 */
export interface AnalysisView<TRow> extends Iterable<TRow> {
  /** A fresh iterator over this view's rows, computed on demand. Calling this again re-derives the rows from scratch. */
  rows(): IterableIterator<TRow>;
  /** Materialize every row into a plain array. This is the one place a view's *derived* rows get copied into a concrete collection - the underlying dataset itself is still never copied. */
  toArray(): TRow[];
  /** Number of rows this view would produce, computed lazily (and freshly on each access) without materializing them. */
  readonly rowCount: number;
}

/** Build an {@link AnalysisView} from a row generator and a row-count function. Internal helper shared by every query in this package. */
export function createAnalysisView<TRow>(rowsFactory: () => IterableIterator<TRow>, countRows: () => number): AnalysisView<TRow> {
  return {
    rows: rowsFactory,
    toArray(): TRow[] {
      return [...rowsFactory()];
    },
    get rowCount(): number {
      return countRows();
    },
    [Symbol.iterator](): IterableIterator<TRow> {
      return rowsFactory();
    }
  };
}
