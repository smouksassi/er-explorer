import type {
  DistPanelSpec,
  DistributionLinkage,
  FacetKey,
  Filter,
  LayoutDimension,
  ScatterPanelSpec,
  ViewLayoutSpec
} from "@er-explorer/domain";
import { panelEndpointMode } from "@er-explorer/domain";
import { getColumn, type LoadedDataset } from "./loadedDataset";
import { isMissing } from "./rawValue";
import { selectRecordIndices } from "./filters";
import { buildVariableLevelModel, levelForRow } from "./variableBins";

export interface ViewLayoutEnumerateInput {
  xMetricIds: string[];
  endpointIds: string[];
  doseVariableId?: string;
}

function orderedIds(dim: LayoutDimension, fallbackIds: string[]): string[] {
  if (dim.kind === "endpoints") return dim.order.length ? dim.order : dim.ids;
  if (dim.kind === "xMetrics") return dim.order.length ? dim.order : dim.ids;
  return dim.order?.length ? dim.order : dim.levels ?? [];
}

function expandDimension(
  loaded: LoadedDataset,
  branchIndices: number[],
  dim: LayoutDimension,
  fallbackEndpoints: string[],
  fallbackXMetrics: string[],
  spec: ViewLayoutSpec,
  modelIndices: number[]
): Array<{ keyPart: FacetKey; indices: number[] }> {
  if (dim.kind === "endpoints") {
    const ids = orderedIds(dim, fallbackEndpoints);
    return ids.map((endpointId) => ({
      keyPart: { endpoint: endpointId },
      indices: branchIndices
    }));
  }
  if (dim.kind === "xMetrics") {
    const ids = orderedIds(dim, fallbackXMetrics);
    return ids.map((xVariableId) => ({
      keyPart: { xMetric: xVariableId },
      indices: branchIndices
    }));
  }
  const varId = dim.variableId;
  // Bin model on the BASE cohort (ADR-0012), never on the nested branch: binning
  // wt inside a study branch gives each study its own median, while the color
  // channel bins globally — the same patient lands in the "≤ median" PANEL but
  // wears the "> median" COLOR. Cut points are global; membership is per branch.
  const model = buildVariableLevelModel(loaded, varId, modelIndices, spec.continuousBinning);
  let levels = [...model.levels];
  if (dim.levels?.length) {
    levels = dim.levels.filter((l: string) => model.levels.includes(l));
  }
  if (dim.order?.length) {
    const order = dim.order;
    levels.sort((a: string, b: string) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }
  return levels.map((level: string) => ({
    keyPart: { [varId]: level },
    indices: branchIndices.filter((i) => levelForRow(i, model, loaded, varId) === level)
  }));
}

function cartesianFacetBranches(
  loaded: LoadedDataset,
  baseIndices: number[],
  dimensions: LayoutDimension[],
  input: ViewLayoutEnumerateInput,
  spec: ViewLayoutSpec,
  modelIndices?: number[]
): Array<{ facetKey: FacetKey; indices: number[] }> {
  const binBase = modelIndices ?? baseIndices;
  let branches: Array<{ facetKey: FacetKey; indices: number[] }> = [{ facetKey: {}, indices: baseIndices }];
  for (const dim of dimensions) {
    const next: Array<{ facetKey: FacetKey; indices: number[] }> = [];
    for (const branch of branches) {
      const parts = expandDimension(loaded, branch.indices, dim, input.endpointIds, input.xMetricIds, spec, binBase);
      for (const part of parts) {
        next.push({
          facetKey: { ...branch.facetKey, ...part.keyPart },
          indices: part.indices
        });
      }
    }
    branches = next;
  }
  return branches;
}

function resolveEndpointAndX(
  facetKey: FacetKey,
  input: ViewLayoutEnumerateInput
): { endpointId: string; xVariableId: string } {
  const endpointId = facetKey.endpoint ?? input.endpointIds[0] ?? "";
  const xVariableId = facetKey.xMetric ?? input.xMetricIds[0] ?? "";
  return { endpointId, xVariableId };
}

function stablePanelId(prefix: string, facetKey: FacetKey, extra?: string): string {
  const parts = Object.keys(facetKey)
    .sort()
    .map((k) => `${k}=${facetKey[k]}`);
  return [prefix, ...parts, extra].filter(Boolean).join("|");
}

function attachMultiEndpointIds(
  panels: ScatterPanelSpec[],
  spec: ViewLayoutSpec,
  input: ViewLayoutEnumerateInput
): ScatterPanelSpec[] {
  return panels.map((p) => {
    if (panelEndpointMode(spec, p.facetKey, input.endpointIds.length) !== "multiColor") return p;
    return {
      ...p,
      endpointIds: input.endpointIds,
      endpointId: input.endpointIds[0] ?? p.endpointId
    };
  });
}

/**
 * Build scatter panel specs from layout spec and filtered row indices.
 */
export function enumerateScatterPanels(
  loaded: LoadedDataset,
  filters: ReadonlyArray<Filter>,
  spec: ViewLayoutSpec,
  input: ViewLayoutEnumerateInput,
  baseRowIndices?: number[]
): ScatterPanelSpec[] {
  const baseIndices = baseRowIndices ?? [...selectRecordIndices(loaded, filters)];

  // ONE enumeration path (rethink A4 — Guided is presets that write the spec):
  // the former guided-compare special branch produced the same panels as the
  // general path below (attachMultiEndpointIds marks color=endpoints overlay
  // cells), minus an "|overlay" id suffix. Deleted in E4.

  const allDims = [...spec.rowDimensions, ...spec.colDimensions];
  if (!allDims.length) {
    const xId = input.xMetricIds[0] ?? "";
    const epId = input.endpointIds[0] ?? "";
    const facetKey: FacetKey = { xMetric: xId };
    if (input.endpointIds.length === 1) facetKey.endpoint = epId;
    const panel: ScatterPanelSpec = {
      id: stablePanelId("scatter", facetKey),
      facetKey,
      xVariableId: xId,
      endpointId: epId,
      rowIndices: baseIndices
    };
    return attachMultiEndpointIds([panel], spec, input);
  }

  const rowBranches = spec.rowDimensions.length
    ? cartesianFacetBranches(loaded, baseIndices, spec.rowDimensions, input, spec)
    : [{ facetKey: {} as FacetKey, indices: baseIndices }];
  const panels: ScatterPanelSpec[] = [];

  for (const row of rowBranches) {
    // The synthetic no-columns branch contributes NOTHING to the facet key:
    // injecting endpoint clobbered row-faceted endpoints, and injecting xMetric
    // clobbered row-faceted metrics (same bug, other axis). resolveEndpointAndX
    // falls back to the first ids when no facet sets them, and the scale-bearing
    // rule (ensureScaleBearingFacets) guarantees multi-level metrics/endpoints
    // are faceted before enumeration ever sees them.
    const colBranches = spec.colDimensions.length
      ? cartesianFacetBranches(loaded, row.indices, spec.colDimensions, input, spec, baseIndices)
      : [{ facetKey: {} as FacetKey, indices: row.indices }];

    for (const col of colBranches) {
      const facetKey = { ...row.facetKey, ...col.facetKey };
      let { endpointId, xVariableId } = resolveEndpointAndX(facetKey, input);
      if (!facetKey.xMetric && input.xMetricIds.length === 1) {
        xVariableId = input.xMetricIds[0]!;
        facetKey.xMetric = xVariableId;
      }
      if (!facetKey.endpoint && input.endpointIds.length === 1) {
        endpointId = input.endpointIds[0]!;
        facetKey.endpoint = endpointId;
      }
      const indices = row.indices.filter((i) => col.indices.includes(i));
      panels.push({
        id: stablePanelId("scatter", facetKey),
        facetKey,
        xVariableId,
        endpointId,
        rowIndices: indices
      });
    }
  }

  return attachMultiEndpointIds(panels, spec, input);
}

function facetKeyMatchesSubset(full: FacetKey, subset: FacetKey): boolean {
  for (const k of Object.keys(subset)) {
    if (full[k] !== subset[k]) return false;
  }
  return true;
}

/**
 * ADR-0012 dist dedup, refined by strip rule P1 (E3): the strip describes
 * exposure of a cohort — it varies by facet slice (and color split) but NOT by
 * endpoint, so endpoint ROW facets collapse (vertical mirror strips would be
 * exact duplicates). Endpoint COLUMNS are different: each column is its own
 * x-axis INSTANCE, so each gets its own strip — same data, but column-aligned
 * (one full-width strip under half-width scatter columns broke the mirror; the
 * per-column readout also fits that column's endpoint). Shared-by-column stays
 * the derived outcome when no facets exist.
 */
function distCollapseKey(spec: ViewLayoutSpec, panel: ScatterPanelSpec): string {
  const endpointsOnColumns = spec.colDimensions.some((d) => d.kind === "endpoints");
  const parts = Object.keys(panel.facetKey)
    .filter((k) => (k === "endpoint" ? endpointsOnColumns : k !== "xMetric"))
    .sort()
    .map((k) => `${k}=${panel.facetKey[k]}`);
  return [`x=${panel.xVariableId}`, ...parts].join("|");
}

/**
 * Distribution panels derived from scatter panels and linkage rules.
 */
export function enumerateDistPanels(
  spec: ViewLayoutSpec,
  scatterPanels: ScatterPanelSpec[],
  readoutEndpointId: string,
  readoutEndpointIds?: string[],
  selectedEndpointCount?: number
): DistPanelSpec[] {
  const groups = new Map<
    string,
    {
      facetKey: FacetKey;
      xVariableId: string;
      rowIndices: number[];
      scatterPanelIds: string[];
      readoutEndpointId: string;
      endpointIds: string[];
    }
  >();

  const endpointsOnColumns = spec.colDimensions.some((d) => d.kind === "endpoints");
  for (const panel of scatterPanels) {
    const key = distCollapseKey(spec, panel);
    let existing = groups.get(key);
    if (!existing) {
      const facetKey: FacetKey = { ...panel.facetKey };
      // Endpoint COLUMN strips keep their endpoint (column identity + readout);
      // endpoint ROW strips collapse over it (P1/P2).
      if (!endpointsOnColumns) delete facetKey.endpoint;
      facetKey.xMetric = panel.xVariableId;
      existing = {
        facetKey,
        xVariableId: panel.xVariableId,
        rowIndices: [],
        scatterPanelIds: [],
        readoutEndpointId: panel.endpointId,
        endpointIds: []
      };
      groups.set(key, existing);
    }
    const indexSet = new Set(existing.rowIndices);
    for (const i of panel.rowIndices) indexSet.add(i);
    existing.rowIndices = [...indexSet];
    existing.scatterPanelIds.push(panel.id);
    for (const ep of panel.endpointIds ?? [panel.endpointId]) {
      if (ep && !existing.endpointIds.includes(ep)) existing.endpointIds.push(ep);
    }
  }

  const distPanels: DistPanelSpec[] = [];
  for (const [key, g] of groups) {
    distPanels.push({
      id: `dist|${key}`,
      facetKey: g.facetKey,
      xVariableId: g.xVariableId,
      readoutEndpointId: g.readoutEndpointId || readoutEndpointId,
      // Every endpoint sharing the strip: the readout lists a fit line per
      // endpoint; row shapes stay endpoint-agnostic (one-channel rule). A
      // per-column strip (P1: endpoint on columns) reads out ONLY its column's
      // endpoint — never the whole selected list.
      readoutEndpointIds:
        g.endpointIds.length > 1
          ? g.endpointIds
          : endpointsOnColumns && g.facetKey.endpoint
            ? [g.facetKey.endpoint]
            : readoutEndpointIds,
      rowIndices: g.rowIndices,
      scatterPanelIds: g.scatterPanelIds
    });
  }
  return distPanels;
}

/** Expected scatter/dist counts for Guided parity tests. Dist cells collapse over
 * endpoints (ADR-0012 dedup), so with no variable facets there is exactly one
 * strip per exposure metric regardless of endpoint count or linkage. */
export function countPanelsForGuidedTopology(opts: {
  endpointCount: number;
  xMetricCount: number;
  compareEndpoints: boolean;
  exposureRows: boolean;
  distLinkage: DistributionLinkage;
}): { scatter: number; dist: number } {
  const { endpointCount, xMetricCount, compareEndpoints, exposureRows } = opts;
  const scatter = compareEndpoints ? xMetricCount : endpointCount * xMetricCount;
  void exposureRows;
  return { scatter, dist: xMetricCount };
}

export { facetKeyMatchesSubset };
