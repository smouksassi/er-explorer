import type { DistributionLinkage, LayoutDimension, LinetypeEncoding, VariableColorBinning, ViewLayoutSpec } from "@er-explorer/domain";
import { dedupeFacetDimensions, resolveGrouping, resolveLinetype } from "@er-explorer/domain";

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
  // Implicit dims (ensureScaleBearingFacets) are derived, not authored: showing
  // them selected would turn them into sticky user choices on the next read —
  // e.g. an implicit metrics COLUMN that can never be moved to rows.
  const tokens = new Set(dimensions.filter((d) => !d.implicit).map(facetTokenForDimension));
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
  groupCurvesValue: string,
  linetypeValue: string,
  distLinkage: DistributionLinkage,
  colorDistShapes: boolean,
  _endpointOverlay: boolean
): ViewLayoutSpec {
  const rowDimensions = readFacetDimensionsFromSelect(rowSelect, endpoints, xMetrics);
  const colDimensions = readFacetDimensionsFromSelect(colSelect, endpoints, xMetrics);

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

  return dedupeFacetDimensions({
    mode: "advanced",
    rowDimensions,
    colDimensions,
    color,
    continuousBinning: binning,
    // Rethink §J: explicit statistical grouping — any variable (or dose), with
    // any channel. Whether the groups are visually distinguishable is the
    // constancy theorem's job, not a UI restriction.
    grouping: { variableIds: groupCurvesValue ? [groupCurvesValue] : [] },
    linetype:
      linetypeValue === "none"
        ? ({ kind: "none" } as LinetypeEncoding)
        : linetypeValue === "endpoints" || !linetypeValue
          ? ({ kind: "endpoints" } as LinetypeEncoding)
          : ({ kind: "variable", variableId: linetypeValue, binning } as LinetypeEncoding),
    endpointOverlay: false,
    distribution: { linkage: distLinkage, colorDistShapes },
    observedGroupVariableId: color.kind === "variable" ? color.variableId : undefined
  });
}

export function applyAdvancedSpecToUi(
  spec: ViewLayoutSpec,
  rowSelect: HTMLSelectElement,
  colSelect: HTMLSelectElement,
  colorSelect: HTMLSelectElement,
  colorBinningSelect: HTMLSelectElement,
  groupCurvesEl: HTMLSelectElement,
  linetypeEl: HTMLSelectElement,
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
  const groupIds = resolveGrouping(spec);
  const groupValue = groupIds[0] ?? "";
  if ([...groupCurvesEl.options].some((o) => o.value === groupValue)) {
    groupCurvesEl.value = groupValue;
  } else {
    groupCurvesEl.value = "";
  }
  const lt = resolveLinetype(spec);
  const ltValue = lt.kind === "variable" ? lt.variableId : lt.kind;
  if ([...linetypeEl.options].some((o) => o.value === ltValue)) {
    linetypeEl.value = ltValue;
  } else {
    linetypeEl.value = "endpoints";
  }
  distLinkageEl.value = spec.distribution.linkage;
  colorDistShapesEl.checked = spec.distribution.colorDistShapes;
  endpointOverlayEl.checked = !!spec.endpointOverlay;
}
