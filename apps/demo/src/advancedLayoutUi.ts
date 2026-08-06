import type { DistributionLinkage, LayoutDimension, VariableColorBinning, ViewLayoutSpec } from "@er-explorer/domain";

export function linkageFromSelectValue(value: string): DistributionLinkage {
  switch (value) {
    case "mirror_scatter_grid":
    case "shared_by_x_column":
    case "single_pooled":
    case "mirror_color_only":
      return value;
    default:
      return "shared_by_x_column";
  }
}

export function parseFacetDimensionToken(
  token: string,
  endpoints: string[],
  xMetrics: string[]
): LayoutDimension | null {
  if (token === "endpoints") {
    return { kind: "endpoints", ids: endpoints, order: endpoints };
  }
  if (token === "xMetrics") {
    return { kind: "xMetrics", ids: xMetrics, order: xMetrics };
  }
  if (token.startsWith("var:")) {
    const variableId = token.slice(4);
    if (!variableId) return null;
    return { kind: "variable", variableId };
  }
  return null;
}

export function facetTokenForDimension(dim: LayoutDimension): string {
  if (dim.kind === "endpoints") return "endpoints";
  if (dim.kind === "xMetrics") return "xMetrics";
  return `var:${dim.variableId}`;
}

export function populateFacetSelectOptions(
  select: HTMLSelectElement,
  covariateOptions: Array<{ id: string; label: string }>
): void {
  const selected = new Set([...select.selectedOptions].map((o) => o.value));
  select.innerHTML = "";
  const add = (value: string, label: string) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = selected.has(value);
    select.appendChild(opt);
  };
  add("endpoints", "Endpoints (response rows/cols)");
  add("xMetrics", "Exposure metrics (X columns/rows)");
  for (const c of covariateOptions) {
    add(`var:${c.id}`, c.label);
  }
}

export function readFacetDimensionsFromSelect(
  select: HTMLSelectElement,
  endpoints: string[],
  xMetrics: string[]
): LayoutDimension[] {
  const dims: LayoutDimension[] = [];
  for (const opt of select.options) {
    if (!opt.selected) continue;
    const d = parseFacetDimensionToken(opt.value, endpoints, xMetrics);
    if (d) dims.push(d);
  }
  return dims;
}

export function applyFacetSelectFromSpec(select: HTMLSelectElement, dimensions: LayoutDimension[]): void {
  const tokens = new Set(dimensions.map(facetTokenForDimension));
  for (const opt of select.options) {
    opt.selected = tokens.has(opt.value);
  }
}

export function readAdvancedSpecFromUi(
  endpoints: string[],
  xMetrics: string[],
  rowSelect: HTMLSelectElement,
  colSelect: HTMLSelectElement,
  colorValue: string,
  colorBinningValue: string,
  fitByColor: boolean,
  distLinkage: DistributionLinkage,
  colorDistShapes: boolean,
  endpointOverlay: boolean
): ViewLayoutSpec {
  const rowDimensions = readFacetDimensionsFromSelect(rowSelect, endpoints, xMetrics);
  const colDimensions = readFacetDimensionsFromSelect(colSelect, endpoints, xMetrics);
  const hasEndpointFacet = [...rowDimensions, ...colDimensions].some((d) => d.kind === "endpoints");

  let color: ViewLayoutSpec["color"];
  const binning =
    colorBinningValue === "tertiles" || colorBinningValue === "quartiles" || colorBinningValue === "median"
      ? (colorBinningValue as VariableColorBinning)
      : "median";
  if (colorValue === "dose") color = { kind: "dose" };
  else if (colorValue === "endpoints") color = { kind: "endpoints" };
  else {
    color = { kind: "variable", variableId: colorValue, binning };
  }

  const fitByColorAllowed = color.kind === "variable";

  return {
    mode: "advanced",
    rowDimensions,
    colDimensions,
    color,
    continuousBinning: binning,
    fitByColor: fitByColorAllowed ? fitByColor : false,
    endpointOverlay: hasEndpointFacet ? false : endpointOverlay,
    distribution: { linkage: distLinkage, colorDistShapes },
    observedGroupVariableId: color.kind === "variable" ? color.variableId : undefined
  };
}

export function applyAdvancedSpecToUi(
  spec: ViewLayoutSpec,
  rowSelect: HTMLSelectElement,
  colSelect: HTMLSelectElement,
  colorSelect: HTMLSelectElement,
  colorBinningSelect: HTMLSelectElement,
  fitByColorEl: HTMLInputElement,
  distLinkageEl: HTMLSelectElement,
  colorDistShapesEl: HTMLInputElement,
  endpointOverlayEl: HTMLInputElement
): void {
  applyFacetSelectFromSpec(rowSelect, spec.rowDimensions);
  applyFacetSelectFromSpec(colSelect, spec.colDimensions);
  if (spec.color.kind === "dose") colorSelect.value = "dose";
  else if (spec.color.kind === "endpoints") colorSelect.value = "endpoints";
  else colorSelect.value = spec.color.variableId;
  if (spec.color.kind === "variable" && spec.color.binning) {
    colorBinningSelect.value = spec.color.binning;
  } else if (spec.continuousBinning) {
    colorBinningSelect.value = spec.continuousBinning;
  } else {
    colorBinningSelect.value = "median";
  }
  fitByColorEl.checked = spec.fitByColor;
  distLinkageEl.value = spec.distribution.linkage;
  colorDistShapesEl.checked = spec.distribution.colorDistShapes;
  endpointOverlayEl.checked = !!spec.endpointOverlay;
}
