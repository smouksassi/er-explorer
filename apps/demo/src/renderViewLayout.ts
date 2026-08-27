import type { DistPanelSpec, ScatterPanelSpec, ViewLayoutSpec } from "@er-explorer/domain";
import { isGuidedCompareTopology } from "@er-explorer/domain";

export interface FacetGridMountOptions {
  escapeHtml: (s: string) => string;
  /** Row strip label (left gutter). */
  rowStripLabel: (panelsInStrip: ScatterPanelSpec[]) => string;
  createFacetLayoutShell: () => HTMLElement;
  attachFacetLayoutSplitter: (facet: HTMLElement) => void;
  appendScatterCell: (grid: HTMLElement, panel: ScatterPanelSpec) => void;
  appendDistCell: (grid: HTMLElement, panel: DistPanelSpec) => void;
  /** Called when >1 dist grid stacks in one block, so the host can widen the dist pane share. */
  onDistGridsMounted?: (facet: HTMLElement, gridCount: number) => void;
}

function usesStackedFacetShells(spec: ViewLayoutSpec): boolean {
  if (isGuidedCompareTopology(spec)) return false;
  const rowX =
    spec.rowDimensions.length === 1 &&
    spec.rowDimensions[0]!.kind === "xMetrics" &&
    spec.colDimensions.length === 1 &&
    spec.colDimensions[0]!.kind === "endpoints";
  return rowX;
}

function sortPanelsByColOrder(panels: ScatterPanelSpec[], spec: ViewLayoutSpec): ScatterPanelSpec[] {
  const dims = spec.colDimensions.length ? spec.colDimensions : spec.rowDimensions;
  if (!dims.length) return panels;
  // Enumeration emits panels in level-model order (e.g. "≤ median" before
  // "> median" for binned covariates); when a dimension has no explicit order,
  // preserve that input order instead of sorting labels alphabetically.
  const inputRank = new Map(panels.map((p, i) => [p.id, i]));
  return [...panels].sort((a, b) => {
    for (const dim of spec.colDimensions) {
      let ka: string;
      let kb: string;
      if (dim.kind === "endpoints") {
        ka = a.endpointId;
        kb = b.endpointId;
      } else if (dim.kind === "xMetrics") {
        ka = a.xVariableId;
        kb = b.xVariableId;
      } else {
        ka = a.facetKey[dim.variableId] ?? "";
        kb = b.facetKey[dim.variableId] ?? "";
      }
      const order = dim.kind === "variable" ? (dim.order ?? dim.levels ?? []) : dim.order;
      const ia = order.indexOf(ka);
      const ib = order.indexOf(kb);
      const cmp = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      if (cmp !== 0) return cmp;
    }
    return (inputRank.get(a.id) ?? 0) - (inputRank.get(b.id) ?? 0);
  });
}

function rowStripKey(panel: ScatterPanelSpec, spec: ViewLayoutSpec): string {
  if (usesStackedFacetShells(spec)) return panel.xVariableId;
  if (!spec.rowDimensions.length) return "all";
  const parts: string[] = [];
  for (const dim of spec.rowDimensions) {
    if (dim.kind === "endpoints") parts.push(`ep:${panel.endpointId}`);
    else if (dim.kind === "xMetrics") parts.push(`x:${panel.xVariableId}`);
    else if (dim.kind === "variable") parts.push(`${dim.variableId}:${panel.facetKey[dim.variableId] ?? ""}`);
  }
  return parts.join("\0");
}

function comparePanelsByRowDimensions(a: ScatterPanelSpec, b: ScatterPanelSpec, spec: ViewLayoutSpec): number {
  for (const dim of spec.rowDimensions) {
    let ka: string;
    let kb: string;
    if (dim.kind === "endpoints") {
      ka = a.endpointId;
      kb = b.endpointId;
    } else if (dim.kind === "xMetrics") {
      ka = a.xVariableId;
      kb = b.xVariableId;
    } else {
      ka = a.facetKey[dim.variableId] ?? "";
      kb = b.facetKey[dim.variableId] ?? "";
    }
    const order = dim.kind === "variable" ? (dim.order ?? dim.levels ?? []) : dim.order;
    const ia = order.indexOf(ka);
    const ib = order.indexOf(kb);
    const cmp = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    if (cmp !== 0) return cmp;
    // No explicit order → keep enumeration (level-model) order: sort() is stable,
    // so returning 0 preserves input order (alphabetical would put "> median"
    // before "≤ median").
  }
  return 0;
}

function groupByRowStrip(panels: ScatterPanelSpec[], spec: ViewLayoutSpec): Map<string, ScatterPanelSpec[]> {
  const map = new Map<string, ScatterPanelSpec[]>();
  for (const p of panels) {
    const key = rowStripKey(p, spec);
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}

function sortDistPanelsByScatterColumns(
  distPanels: DistPanelSpec[],
  scatterPanels: ScatterPanelSpec[],
  spec: ViewLayoutSpec
): DistPanelSpec[] {
  if (!distPanels.length || !scatterPanels.length) return distPanels;
  const colSorted = sortPanelsByColOrder(scatterPanels, spec);
  const rank = new Map(colSorted.map((p, i) => [p.id, i]));
  return [...distPanels].sort((a, b) => {
    const rankFor = (dp: DistPanelSpec) =>
      Math.min(...dp.scatterPanelIds.map((id) => rank.get(id) ?? 999));
    const ra = rankFor(a);
    const rb = rankFor(b);
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Row-slice key for a dist panel: the non-endpoint row facet parts (ADR-0012 —
 * strips collapse over endpoints, so endpoint row dims contribute nothing).
 * "" = every dist panel shares one grid (the derived shared-by-column layout).
 */
function distRowKey(panel: DistPanelSpec, spec: ViewLayoutSpec): string {
  const parts: string[] = [];
  for (const dim of spec.rowDimensions) {
    if (dim.kind === "endpoints") continue;
    if (dim.kind === "xMetrics") parts.push(`x:${panel.xVariableId}`);
    else parts.push(`${dim.variableId}:${panel.facetKey[dim.variableId] ?? ""}`);
  }
  return parts.join("\0");
}

/**
 * Mount scatter + distribution DOM from enumerated panel specs (Guided and Advanced).
 */
export function mountViewLayoutGrid(
  container: HTMLElement,
  spec: ViewLayoutSpec,
  scatterPanels: ScatterPanelSpec[],
  distPanels: DistPanelSpec[],
  opts: FacetGridMountOptions
): void {
  container.innerHTML = "";

  // ONE mount path (rethink A4): the former guided-compare shell was the
  // general no-row-dims mount with a hardcoded banner label — deleted in E4.
  // Multi-endpoint cells route through appendScatterCell (endpointIds > 1).

  const rowGroups = groupByRowStrip(scatterPanels, spec);
  const rowKeys = [...rowGroups.keys()];
  if (spec.rowDimensions.length) {
    rowKeys.sort((ka, kb) => {
      const pa = rowGroups.get(ka)![0]!;
      const pb = rowGroups.get(kb)![0]!;
      return comparePanelsByRowDimensions(pa, pb, spec);
    });
  }

  const stacked = usesStackedFacetShells(spec);

  const mountScatterStrip = (stripPanels: ScatterPanelSpec[], label: string, scatterBlock: HTMLElement) => {
    const rowEl = document.createElement("div");
    rowEl.className = stacked ? "endpoint-row facet-metric-row" : "endpoint-row";
    if (label) rowEl.innerHTML = `<div class="facet-row-label">${opts.escapeHtml(label)}</div>`;
    const rowGrid = document.createElement("div");
    rowGrid.className = "panel-grid";
    rowEl.appendChild(rowGrid);
    scatterBlock.appendChild(rowEl);
    const sorted = sortPanelsByColOrder(stripPanels, spec);
    for (const panel of sorted) {
      opts.appendScatterCell(rowGrid, panel);
    }
    return stripPanels;
  };

  const mountDistGrid = (
    distBlock: HTMLElement,
    panels: DistPanelSpec[],
    sharedClass: boolean,
    scatterColumnRef: ScatterPanelSpec[]
  ) => {
    const distGrid = document.createElement("div");
    distGrid.className = `panel-grid${sharedClass ? " facet-shared-dist-grid" : ""}`;
    const distSorted = sortDistPanelsByScatterColumns(panels, scatterColumnRef, spec);
    for (const dp of distSorted) {
      opts.appendDistCell(distGrid, dp);
    }
    distBlock.appendChild(distGrid);
  };

  if (stacked) {
    for (const key of rowKeys) {
      const stripPanels = rowGroups.get(key)!;
      const facet = opts.createFacetLayoutShell();
      const scatterBlock = facet.querySelector(".facet-scatter-block") as HTMLElement;
      const distBlock = facet.querySelector(".facet-dist-block") as HTMLElement;
      mountScatterStrip(stripPanels, opts.rowStripLabel(stripPanels), scatterBlock);
      const stripScatterIds = new Set(stripPanels.map((p) => p.id));
      const stripDist = distPanels.filter((d) => d.scatterPanelIds.some((id) => stripScatterIds.has(id)));
      mountDistGrid(distBlock, stripDist, false, stripPanels);
      opts.attachFacetLayoutSplitter(facet);
      container.appendChild(facet);
    }
    return;
  }

  const facet = opts.createFacetLayoutShell();
  const scatterBlock = facet.querySelector(".facet-scatter-block") as HTMLElement;
  const distBlock = facet.querySelector(".facet-dist-block") as HTMLElement;

  if (rowKeys.length === 0 || (rowKeys.length === 1 && rowKeys[0] === "all")) {
    mountScatterStrip(scatterPanels, opts.rowStripLabel(scatterPanels), scatterBlock);
  } else {
    for (const key of rowKeys) {
      const stripPanels = rowGroups.get(key)!;
      mountScatterStrip(stripPanels, opts.rowStripLabel(stripPanels), scatterBlock);
    }
  }

  // One dist grid per non-endpoint row slice (ADR-0012 dedup): strips collapsed
  // over endpoints mount exactly once, in scatter row order; with no non-endpoint
  // row dims everything shares a single grid (the derived shared-by-column look).
  const distRowKeys: string[] = [];
  const distByRowKey = new Map<string, DistPanelSpec[]>();
  for (const dp of distPanels) {
    const key = distRowKey(dp, spec);
    if (!distByRowKey.has(key)) {
      distByRowKey.set(key, []);
      distRowKeys.push(key);
    }
    distByRowKey.get(key)!.push(dp);
  }
  if (distRowKeys.length <= 1) {
    mountDistGrid(distBlock, distPanels, distPanels.length > 1, scatterPanels);
  } else {
    for (const key of distRowKeys) {
      const stripDist = distByRowKey.get(key)!;
      const stripScatterIds = new Set(stripDist.flatMap((d) => d.scatterPanelIds));
      const refPanels = scatterPanels.filter((p) => stripScatterIds.has(p.id));
      mountDistGrid(distBlock, stripDist, false, refPanels.length ? refPanels : scatterPanels);
    }
    // N vertically-repeated dist grids need N strips' worth of height, not one
    // strip's share split N ways (charts bled under the following grids).
    opts.onDistGridsMounted?.(facet, distRowKeys.length);
  }

  opts.attachFacetLayoutSplitter(facet);
  container.appendChild(facet);
}
