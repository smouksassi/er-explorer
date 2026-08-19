import type {
  DistPanelSpec,
  DistributionLinkage,
  FacetKey,
  Filter,
  LayoutDimension,
  ScatterPanelSpec,
  ViewLayoutSpec
} from "@er-explorer/domain";
import { isGuidedCompareTopology, panelEndpointMode } from "@er-explorer/domain";
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

  if (isGuidedCompareTopology(spec)) {
    const colBranches = cartesianFacetBranches(loaded, baseIndices, spec.colDimensions, input, spec);
    const rowBranches =
      spec.rowDimensions.length > 0
        ? cartesianFacetBranches(loaded, baseIndices, spec.rowDimensions, input, spec)
        : [{ facetKey: {} as FacetKey, indices: baseIndices }];

    const panels: ScatterPanelSpec[] = [];
    for (const row of rowBranches) {
      for (const col of colBranches) {
        const facetKey = { ...row.facetKey, ...col.facetKey };
        const { xVariableId } = resolveEndpointAndX(facetKey, input);
        const endpointIds =
          spec.color.kind === "endpoints"
            ? input.endpointIds
            : facetKey.endpoint
              ? [facetKey.endpoint]
              : input.endpointIds;
        const indices = row.indices.filter((i) => col.indices.includes(i));
        panels.push({
          id: stablePanelId("scatter", facetKey, "overlay"),
          facetKey,
          xVariableId,
          endpointId: endpointIds[0] ?? input.endpointIds[0] ?? "",
          endpointIds,
          rowIndices: indices
        });
      }
    }
    if (panels.length) return panels;
  }

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
 * ADR-0012 dist dedup: the strip describes exposure of a cohort — it varies by
 * facet slice (and color split) but NOT by endpoint, so per-endpoint mirror
 * strips are exact duplicates by construction. Dist cells collapse over the
 * endpoint dimension and keep every non-endpoint facet slice. This replaces the
 * user-facing "distribution layout" linkage choice: shared-by-column is now the
 * derived outcome when no non-endpoint facets exist.
 */
function distCollapseKey(panel: ScatterPanelSpec): string {
  const parts = Object.keys(panel.facetKey)
    .filter((k) => k !== "endpoint" && k !== "xMetric")
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

  for (const panel of scatterPanels) {
    const key = distCollapseKey(panel);
    let existing = groups.get(key);
    if (!existing) {
      const facetKey: FacetKey = { ...panel.facetKey };
      delete facetKey.endpoint;
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
      // endpoint; row shapes stay endpoint-agnostic (one-channel rule).
      readoutEndpointIds: g.endpointIds.length > 1 ? g.endpointIds : readoutEndpointIds,
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
