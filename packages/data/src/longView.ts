import type { Filter } from "@er-explorer/domain";
import { countMatchingRecords, selectRecordIndices } from "./filters";
import { getColumn, type LoadedDataset } from "./loadedDataset";
import type { RawCellValue } from "./rawValue";
import { type AnalysisView, createAnalysisView } from "./views";

/** One row of a long/tidy derived view: a single (record, exposure metric, endpoint) observation. */
export interface LongViewRow {
  /** Row index into the original LoadedDataset this observation came from. */
  recordIndex: number;
  /** Value of `identifierVariableId`, if one was given in the query, for a human-meaningful subject id instead of a bare row index. */
  recordId?: RawCellValue;
  /** Which exposure metric this row's `exposureValue` is drawn from. */
  exposureMetricId: string;
  exposureValue: RawCellValue;
  /** Which endpoint this row's `endpointValue` is drawn from. */
  endpointId: string;
  endpointValue: RawCellValue;
  /** Snapshot of every requested covariate's value for this record, attached (not exploded) since a covariate doesn't vary by exposure metric or endpoint the way the two faceting dimensions above do. */
  covariates: Record<string, RawCellValue>;
}

export interface LongViewQuery {
  /** Exposure metric(s) to include - one or more; the view gets one row per metric per (record, endpoint). */
  exposureMetricIds: string[];
  /** Endpoint(s) to include - one or more; the view gets one row per endpoint per (record, exposure metric). */
  endpointIds: string[];
  /** Covariate(s) to attach to every row for this record, without exploding rows further. */
  covariateIds?: string[];
  /** Population-narrowing constraints (see `@er-explorer/domain`'s `Filter`), applied before faceting by exposure metric/endpoint. */
  filters?: Filter[];
  /** Variable id to read a human-meaningful subject identifier from, for `LongViewRow.recordId`. */
  identifierVariableId?: string;
}

/**
 * Build a derived long ("tidy") view: one row per
 * (filtered record x exposure metric x endpoint) combination - mirroring
 * the reference R package's `facet_grid(Endpoint ~ expname)` layout, and
 * exactly what a multi-exposure-metric, multi-endpoint "Compare Endpoints"
 * style analysis needs, generated on demand rather than precomputed and
 * stored.
 *
 * Supports any number of exposure metrics, endpoints, and covariates at
 * once - the cross product is just nested iteration, not a precomputed
 * table - and never copies `loaded`'s column data: filtering walks row
 * indices (`selectRecordIndices`) and each row reads straight out of
 * `loaded.columns` at iteration time (see {@link AnalysisView}).
 */
export function queryLongView(loaded: LoadedDataset, query: LongViewQuery): AnalysisView<LongViewRow> {
  const filters = query.filters ?? [];
  const covariateIds = query.covariateIds ?? [];

  function* rows(): IterableIterator<LongViewRow> {
    for (const recordIndex of selectRecordIndices(loaded, filters)) {
      const recordId = query.identifierVariableId ? getColumn(loaded, query.identifierVariableId)[recordIndex] : undefined;

      const covariates: Record<string, RawCellValue> = {};
      for (const covariateId of covariateIds) {
        covariates[covariateId] = getColumn(loaded, covariateId)[recordIndex] ?? null;
      }

      for (const exposureMetricId of query.exposureMetricIds) {
        const exposureValue = getColumn(loaded, exposureMetricId)[recordIndex] ?? null;
        for (const endpointId of query.endpointIds) {
          const endpointValue = getColumn(loaded, endpointId)[recordIndex] ?? null;
          yield { recordIndex, recordId, exposureMetricId, exposureValue, endpointId, endpointValue, covariates };
        }
      }
    }
  }

  return createAnalysisView(
    rows,
    () => countMatchingRecords(loaded, filters) * query.exposureMetricIds.length * query.endpointIds.length
  );
}
