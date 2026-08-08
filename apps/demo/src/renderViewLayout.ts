import type { DistPanelSpec, ScatterPanelSpec, ViewLayoutSpec } from "@er-explorer/domain";
import { isGuidedCompareTopology } from "@er-explorer/domain";

export interface FacetGridMountOptions {
  escapeHtml: (s: string) => string;
  /** Row strip label (left gutter). */
  rowStripLabel: (panelsInStrip: ScatterPanelSpec[]) => string;
  createFacetLayoutShell: () => HTMLElement;
  attachFacetLayoutSplitter: (facet: HTMLElement) => void;
  appendScatterCell: (grid: HTMLElement, panel: ScatterPanelSpec) => void;
  appendCompareScatterCell: (grid: HTMLElement, panel: ScatterPanelSpec) => void;
  appendDistCell: (grid: HTMLElement, panel: DistPanelSpec) => void;
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
    return a.id.localeCompare(b.id);
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
    const lc = ka.localeCompare(kb);
    if (lc !== 0) return lc;
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

function distUsesSharedGridClass(spec: ViewLayoutSpec): boolean {
  return spec.distribution.linkage === "shared_by_x_column" && !isGuidedCompareTopology(spec);
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

  if (isGuidedCompareTopology(spec)) {
    const facet = opts.createFacetLayoutShell();
    const scatterBlock = facet.querySelector(".facet-scatter-block") as HTMLElement;
    const distBlock = facet.querySelector(".facet-dist-block") as HTMLElement;

    const rowEl = document.createElement("div");
    rowEl.className = "endpoint-row";
    rowEl.innerHTML = `<div class="facet-row-label">Response · endpoints overlaid</div>`;
    const rowGrid = document.createElement("div");
    rowGrid.className = "panel-grid";
    rowEl.appendChild(rowGrid);
    scatterBlock.appendChild(rowEl);

    const sorted = sortPanelsByColOrder(scatterPanels, {
      ...spec,
      colDimensions: [{ kind: "xMetrics", ids: scatterPanels.map((p) => p.xVariableId), order: scatterPanels.map((p) => p.xVariableId) }]
    });
    for (const panel of sorted) {
      opts.appendCompareScatterCell(rowGrid, panel);
    }

    const distGrid = document.createElement("div");
    distGrid.className = `panel-grid${distUsesSharedGridClass(spec) ? " facet-shared-dist-grid" : ""}`;
    for (const dp of distPanels) {
      opts.appendDistCell(distGrid, dp);
    }
    distBlock.appendChild(distGrid);
    opts.attachFacetLayoutSplitter(facet);
    container.appendChild(facet);
    return;
  }

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

  const mirrorDistByScatterRow =
    spec.distribution.linkage === "mirror_scatter_grid" &&
    rowKeys.length > 1 &&
    !(rowKeys.length === 1 && rowKeys[0] === "all");

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

  if (distUsesSharedGridClass(spec)) {
    const xOrder =
      spec.colDimensions.find((d) => d.kind === "xMetrics")?.order ?? [...new Set(distPanels.map((d) => d.xVariableId))];
    const byX = new Map(distPanels.map((d) => [d.xVariableId, d]));
    const ordered = xOrder.map((x) => byX.get(x)).filter((d): d is DistPanelSpec => !!d);
    mountDistGrid(distBlock, ordered.length ? ordered : distPanels, true, scatterPanels);
  } else if (mirrorDistByScatterRow) {
    for (const key of rowKeys) {
      const stripPanels = rowGroups.get(key)!;
      const stripScatterIds = new Set(stripPanels.map((p) => p.id));
      const stripDist = distPanels.filter((d) => d.scatterPanelIds.some((id) => stripScatterIds.has(id)));
      mountDistGrid(distBlock, stripDist, false, stripPanels);
    }
  } else {
    mountDistGrid(distBlock, distPanels, false, scatterPanels);
  }

  opts.attachFacetLayoutSplitter(facet);
  container.appendChild(facet);
}
