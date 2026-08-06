import type {
  DistPanelSpec,
  DistributionLinkage,
  FacetKey,
  Filter,
  LayoutDimension,
  ScatterPanelSpec,
  ViewLayoutSpec
} from "@er-explorer/domain";
import { effectiveEndpointOverlay } from "@er-explorer/domain";
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
  baseIndices: number[],
  dim: LayoutDimension,
  fallbackEndpoints: string[],
  fallbackXMetrics: string[],
  spec: ViewLayoutSpec
): Array<{ keyPart: FacetKey; indices: number[] }> {
  if (dim.kind === "endpoints") {
    const ids = orderedIds(dim, fallbackEndpoints);
    return ids.map((endpointId) => ({
      keyPart: { endpoint: endpointId },
      indices: baseIndices
    }));
  }
  if (dim.kind === "xMetrics") {
    const ids = orderedIds(dim, fallbackXMetrics);
    return ids.map((xVariableId) => ({
      keyPart: { xMetric: xVariableId },
      indices: baseIndices
    }));
  }
  const varId = dim.variableId;
  const model = buildVariableLevelModel(loaded, varId, baseIndices, spec.continuousBinning);
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
    indices: baseIndices.filter((i) => levelForRow(i, model, loaded, varId) === level)
  }));
}

function cartesianFacetBranches(
  loaded: LoadedDataset,
  baseIndices: number[],
  dimensions: LayoutDimension[],
  input: ViewLayoutEnumerateInput,
  spec: ViewLayoutSpec
): Array<{ facetKey: FacetKey; indices: number[] }> {
  let branches: Array<{ facetKey: FacetKey; indices: number[] }> = [{ facetKey: {}, indices: baseIndices }];
  for (const dim of dimensions) {
    const next: Array<{ facetKey: FacetKey; indices: number[] }> = [];
    for (const branch of branches) {
      const parts = expandDimension(loaded, branch.indices, dim, input.endpointIds, input.xMetricIds, spec);
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

  if (effectiveEndpointOverlay(spec)) {
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
    return [
      {
        id: stablePanelId("scatter", { endpoint: epId, xMetric: xId }),
        facetKey: { endpoint: epId, xMetric: xId },
        xVariableId: xId,
        endpointId: epId,
        rowIndices: baseIndices
      }
    ];
  }

  const rowBranches = spec.rowDimensions.length
    ? cartesianFacetBranches(loaded, baseIndices, spec.rowDimensions, input, spec)
    : [{ facetKey: {} as FacetKey, indices: baseIndices }];
  const panels: ScatterPanelSpec[] = [];

  for (const row of rowBranches) {
    const colBranches = spec.colDimensions.length
      ? cartesianFacetBranches(loaded, row.indices, spec.colDimensions, input, spec)
      : [
          {
            facetKey: { xMetric: input.xMetricIds[0] ?? "", endpoint: input.endpointIds[0] ?? "" },
            indices: row.indices
          }
        ];

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

  return panels;
}

function facetKeyMatchesSubset(full: FacetKey, subset: FacetKey): boolean {
  for (const k of Object.keys(subset)) {
    if (full[k] !== subset[k]) return false;
  }
  return true;
}

function collapseKeyForLinkage(
  panel: ScatterPanelSpec,
  linkage: DistributionLinkage,
  scatterPanels: ScatterPanelSpec[]
): string {
  const fk = panel.facetKey;
  switch (linkage) {
    case "mirror_scatter_grid":
      return panel.id;
    case "shared_by_x_column":
      return `x=${panel.xVariableId}`;
    case "single_pooled":
      return `x=${panel.xVariableId}|pooled`;
    case "mirror_color_only":
      return `x=${panel.xVariableId}|colorMirror`;
    default:
      return panel.id;
  }
}

/**
 * Distribution panels derived from scatter panels and linkage rules.
 */
export function enumerateDistPanels(
  spec: ViewLayoutSpec,
  scatterPanels: ScatterPanelSpec[],
  readoutEndpointId: string,
  readoutEndpointIds?: string[]
): DistPanelSpec[] {
  const linkage = spec.distribution.linkage;
  const groups = new Map<
    string,
    {
      facetKey: FacetKey;
      xVariableId: string;
      rowIndices: number[];
      scatterPanelIds: string[];
      readoutEndpointId: string;
    }
  >();

  for (const panel of scatterPanels) {
    const key = collapseKeyForLinkage(panel, linkage, scatterPanels);
    let existing = groups.get(key);
    if (!existing) {
      let facetKey: FacetKey;
      if (linkage === "mirror_scatter_grid") facetKey = { ...panel.facetKey };
      else if (linkage === "shared_by_x_column" || linkage === "single_pooled" || linkage === "mirror_color_only") {
        facetKey = { xMetric: panel.xVariableId };
      } else facetKey = { ...panel.facetKey };

      existing = {
        facetKey,
        xVariableId: panel.xVariableId,
        rowIndices: [],
        scatterPanelIds: [],
        readoutEndpointId: panel.endpointId
      };
      groups.set(key, existing);
    }
    const indexSet = new Set(existing.rowIndices);
    for (const i of panel.rowIndices) indexSet.add(i);
    existing.rowIndices = [...indexSet];
    existing.scatterPanelIds.push(panel.id);
  }

  const overlay = effectiveEndpointOverlay(spec);
  const distPanels: DistPanelSpec[] = [];
  for (const [key, g] of groups) {
    distPanels.push({
      id: `dist|${key}`,
      facetKey: g.facetKey,
      xVariableId: g.xVariableId,
      readoutEndpointId: g.readoutEndpointId || readoutEndpointId,
      readoutEndpointIds: overlay ? readoutEndpointIds : undefined,
      rowIndices: g.rowIndices,
      scatterPanelIds: g.scatterPanelIds
    });
  }
  return distPanels;
}

/** Expected scatter/dist counts for Guided parity tests. */
export function countPanelsForGuidedTopology(opts: {
  endpointCount: number;
  xMetricCount: number;
  compareEndpoints: boolean;
  exposureRows: boolean;
  distLinkage: DistributionLinkage;
}): { scatter: number; dist: number } {
  const { endpointCount, xMetricCount, compareEndpoints, exposureRows, distLinkage } = opts;
  if (compareEndpoints) {
    const scatter = xMetricCount;
    const dist =
      distLinkage === "mirror_scatter_grid" ? xMetricCount * endpointCount : xMetricCount;
    return { scatter, dist };
  }
  if (exposureRows) {
    const scatter = xMetricCount * endpointCount;
    const dist = distLinkage === "mirror_scatter_grid" ? scatter : xMetricCount * endpointCount;
    return { scatter, dist };
  }
  const scatter = endpointCount * xMetricCount;
  let dist: number;
  if (distLinkage === "shared_by_x_column") dist = xMetricCount;
  else if (distLinkage === "mirror_scatter_grid") dist = scatter;
  else dist = xMetricCount;
  return { scatter, dist };
}

export { facetKeyMatchesSubset };
