import {
  fitLogisticModel,
  predictLogisticWaldResult,
  bootstrapLogisticCI,
  summarizeDistribution,
  quantile,
  wilsonScoreInterval,
  createModelDefinition,
  type LogisticModel,
  type PredictionResult
} from "@er-explorer/statistical-engine";
import {
  renderLogisticScatterChart,
  renderDistributionChart,
  buildAsymRidgePath,
  scaleLinear,
  seededJitter,
  createVisualizationSpec,
  type Scale,
  type ScatterPoint,
  type ProjectedGroup,
  type DistributionGroupInput,
  type DistributionGroupMeta,
  type DistributionMode,
  type DistributionSplitAnnotation,
  type ObservedResponseBin,
  type ExtraCurve,
  type ReferenceLine
} from "@er-explorer/visualization-engine";
import {
  createSessionState,
  serializeSession,
  parseSession,
  InvalidSessionFileError,
  type SessionState
} from "@er-explorer/session-engine";
import { RECORDS, type ExposureResponseRecord } from "./data.generated";

type ExposureMetric = "auc" | "cmax";
type Endpoint = "icgi" | "icgi2" | "icgi3";
type CIMethod = "wald" | "bootstrap";

const EXPOSURE_ORDER: ExposureMetric[] = ["auc", "cmax"];
const ENDPOINT_ORDER: Endpoint[] = ["icgi", "icgi2", "icgi3"];
const DOSE_ORDER = ["Placebo", "600 mg", "1200 mg", "1800 mg", "2400 mg"];
const DOSE_COLORS: Record<string, string> = {
  Placebo: "#1f77b4",
  "600 mg": "#ff7f0e",
  "1200 mg": "#2ca02c",
  "1800 mg": "#d62728",
  "2400 mg": "#9467bd"
};
/** Used only by the "compare endpoints" overlay view - deliberately distinct from DOSE_COLORS
 * since that view recolors by endpoint instead of by dose. */
const ENDPOINT_COLORS: Record<Endpoint, string> = {
  icgi: "#4C72B0",
  icgi2: "#DDAA33",
  icgi3: "#C44E52"
};
/** SVG stroke-dasharray per endpoint (solid / dotted / dashed) so overlaid curves stay
 * distinguishable even without color (e.g. print, colorblind-safe redundancy). */
const ENDPOINT_DASH: Record<Endpoint, string> = {
  icgi: "",
  icgi2: "2 4",
  icgi3: "9 4"
};
const DATASET_ID = "effICGI-demo-v1";
/** Placebo is excluded from box/violin *shapes* in the exposure distribution panel: by design
 * every placebo patient has zero exposure, so a box/violin of a constant isn't informative (it
 * would just be a degenerate spike). Its row still renders (label + N), it just skips the shape
 * - see the `skipShape` flag passed into `DistributionGroupInput` below. Placebo also appears
 * normally in the scatter, legend, and KPIs. */

type ReferenceLineKind = "median" | "tertiles" | "quartiles";
/** off = no per-dose split annotation; "n" = plain count; "n_pct" = count + percent of that
 * dose group's own patients. */
type SplitAnnotationMode = "off" | "n" | "n_pct";

interface DemoState {
  exposureMetrics: Set<ExposureMetric>;
  /** Each selected endpoint adds a row to the exposure-vs-response grid (rows = endpoints,
   * columns = exposure metrics) - mirrors the R `facet_grid(Endpoint ~ expname)` layout. The
   * exposure distribution panel below stays one row per exposure metric regardless, since dose
   * exposure doesn't depend on endpoint; it uses the first selected endpoint for its response
   * count. */
  endpoints: Set<Endpoint>;
  ciMethod: CIMethod;
  bootstrapSeed: number;
  bootstrapResamples: number;
  /** patient ids selected by brushing in any exposure panel; shared/linked across all panels */
  brushedIds: Set<number> | null;
  selectedDoses: Set<string>;
  distributionMode: DistributionMode;
  /** Only one reference-line split can be active at a time (mirrors the R `exposure_metric_split`
   * parameter, which also takes a single value). */
  referenceLineKind: ReferenceLineKind | null;
  /** Each dose row's own patient count within each split bin (distribution panel) - off by
   * default, since it's an optional add-on to the reference-line split, not always wanted. */
  splitAnnotationMode: SplitAnnotationMode;
  /** Show observed (non-model) response rate + 95% Wilson CI per split bin, plotted against the
   * fitted curve on the scatter panel, for a direct "observed vs fitted" comparison. */
  showObservedResponders: boolean;
  /** Show each active reference-line split's own fitted probability + CI, marked right on the
   * curve (e.g. "83.8" / "fit 0.74 [0.70-0.78]"). Off by default - opt-in, both because it's
   * another marker competing for the same space as showObservedResponders, and because its grey
   * styling is easy to mix up with the (near-black) observed markers if always on. */
  showReferenceFit: boolean;
  /** Show each highlighted (clicked) dose's own observed %/N marker next to its projected curve
   * segment. On by default since it's the natural companion to clicking a dose row, but some
   * users will want the plain projection without it. */
  showDoseObserved: boolean;
  /** Optional alternate view: only meaningful with exactly one exposure metric and 2+ endpoints
   * selected. Replaces the usual dose-colored endpoint-row grid with one panel per endpoint
   * (colored/dashed by endpoint instead of dose) plus an "(all)" panel overlaying every
   * endpoint's curve together - mirrors ggquickeda's endpoint-comparison facet layout. */
  compareEndpoints: boolean;
}

const state: DemoState = {
  exposureMetrics: new Set(["auc"]),
  endpoints: new Set(["icgi"]),
  ciMethod: "wald",
  bootstrapSeed: 12345,
  bootstrapResamples: 300,
  brushedIds: null,
  selectedDoses: new Set(),
  distributionMode: "boxplot",
  referenceLineKind: null,
  splitAnnotationMode: "off",
  showObservedResponders: false,
  showReferenceFit: false,
  showDoseObserved: true,
  compareEndpoints: false
};

/** One entry per currently-rendered distribution panel (one per selected exposure metric),
 * captured at render time so the boxplot<->violin toggle can morph the existing <path>
 * elements in place instead of tearing down and rebuilding the DOM. */
interface DistributionPanelHandle {
  xScale: Scale;
  groups: DistributionGroupMeta[];
  boxHalfHeightPx: number;
  pathEls: (SVGPathElement | null)[];
  capEls: (SVGGElement | null)[];
}
let distributionPanels: DistributionPanelHandle[] = [];
let distributionAnimating = false;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const scatterPanelsEl = $<HTMLDivElement>("scatterPanels");
const boxPanelsEl = $<HTMLDivElement>("boxPanels");
const legendEl = $<HTMLDivElement>("legend");
const statusEl = $<HTMLDivElement>("status");
const exposureGroupEl = $<HTMLDivElement>("exposureGroup");
const distModeGroupEl = $<HTMLDivElement>("distModeGroup");
const refLineGroupEl = $<HTMLDivElement>("refLineGroup");
const refLineNoteEl = $<HTMLDivElement>("refLineNote");
const splitAnnotationModeEl = $<HTMLSelectElement>("splitAnnotationMode");
const showObservedRespEl = $<HTMLInputElement>("showObservedResp");
const showReferenceFitEl = $<HTMLInputElement>("showReferenceFit");
const showDoseObservedEl = $<HTMLInputElement>("showDoseObserved");
const endpointGroupEl = $<HTMLDivElement>("endpointGroup");
const compareEndpointsEl = $<HTMLInputElement>("compareEndpoints");
const endpointLegendEl = $<HTMLDivElement>("endpointLegend");
const ciSelect = $<HTMLSelectElement>("ciSelect");
const resetBtn = $<HTMLButtonElement>("resetBtn");
const saveSessionBtn = $<HTMLButtonElement>("saveSessionBtn");
const loadSessionBtn = $<HTMLButtonElement>("loadSessionBtn");
const fileInput = $<HTMLInputElement>("fileInput");
const sessionStatus = $<HTMLSpanElement>("sessionStatus");
const kpiN = $<HTMLDivElement>("kpiN");
const kpiResponders = $<HTMLDivElement>("kpiResponders");
const kpiRespondersLabel = $<HTMLDivElement>("kpiRespondersLabel");
const kpiShowing = $<HTMLDivElement>("kpiShowing");

const exposureValue = (r: ExposureResponseRecord, metric: ExposureMetric) => (metric === "auc" ? r.auc : r.cmax);
const endpointValue = (r: ExposureResponseRecord, endpoint: Endpoint) => (endpoint === "icgi" ? r.icgi : endpoint === "icgi2" ? r.icgi2 : r.icgi3);
const exposureLabel = (metric: ExposureMetric) => metric.toUpperCase();

function selectedExposureMetrics(): ExposureMetric[] {
  return EXPOSURE_ORDER.filter((m) => state.exposureMetrics.has(m));
}

function selectedEndpoints(): Endpoint[] {
  return ENDPOINT_ORDER.filter((e) => state.endpoints.has(e));
}

/** Chart pixel width for one panel column; the SVG's viewBox keeps it responsive regardless. */
function panelWidth(): number {
  const count = Math.max(1, selectedExposureMetrics().length);
  return Math.max(480, Math.floor(1200 / count));
}

function fitFor(metric: ExposureMetric, endpoint: Endpoint): { model: LogisticModel; xs: number[]; ys: number[] } {
  const xs = RECORDS.map((r) => exposureValue(r, metric));
  const ys = RECORDS.map((r) => endpointValue(r, endpoint));
  const model = fitLogisticModel(xs, ys);
  if (!model) throw new Error(`Unable to fit logistic model for ${metric}/${endpoint}`);
  return { model, xs, ys };
}

function curveFor(model: LogisticModel, xs: number[], xMax: number, endpoint: Endpoint): PredictionResult {
  const dense = Array.from({ length: 121 }, (_, i) => (i * xMax) / 120);
  if (state.ciMethod === "wald") return predictLogisticWaldResult(model, dense);
  return bootstrapLogisticCI(xs, RECORDS.map((r) => endpointValue(r, endpoint)), dense, {
    resamples: state.bootstrapResamples,
    seed: state.bootstrapSeed
  });
}

/**
 * Reference lines (median/tertiles/quartiles) for the given exposure metric, computed on all
 * dosed patients *excluding placebo* - placebo is fixed at zero exposure by design, so including
 * it would pull every cut point down and misrepresent where the treated population actually
 * falls. These are global cut points (not per-dose), so a dose group's box/violin position can
 * be read directly against them: is this group mostly above the global median, above Q3, etc.
 */
function computeReferenceLines(metric: ExposureMetric): ReferenceLine[] {
  const kind = state.referenceLineKind;
  if (!kind) return [];
  const values = RECORDS.filter((r) => r.dose !== "Placebo")
    .map((r) => exposureValue(r, metric))
    .sort((a, b) => a - b);
  if (!values.length) return [];

  const requested: Array<{ p: number; label: string }> =
    kind === "median"
      ? [{ p: 0.5, label: "Median" }]
      : kind === "tertiles"
        ? [{ p: 1 / 3, label: "T1 (33%)" }, { p: 2 / 3, label: "T2 (67%)" }]
        : [{ p: 0.25, label: "Q1 (25%)" }, { p: 0.5, label: "Q2 (50%)" }, { p: 0.75, label: "Q3 (75%)" }];

  // dedupe by value (degenerate data could put two requested percentiles at the same cut
  // point) - merge labels rather than drawing two overlapping lines
  const byValue = new Map<number, string[]>();
  for (const { p, label } of requested) {
    const value = Math.round(quantile(values, p) * 100) / 100;
    const labels = byValue.get(value) ?? [];
    if (!labels.includes(label)) labels.push(label);
    byValue.set(value, labels);
  }
  return [...byValue.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, labels]) => ({ value, label: labels.join(" / ") }));
}

/**
 * For the active reference-line split, count how many of a given dose group's *own* patients
 * fall into each bin the split's cut points define (mirrors ggquickeda's
 * `exposure_metric_split` annotations). Placebo is never passed in here - it's excluded from
 * the split/cutpoint math for the same reason it's excluded from the box/violin shape. Bins
 * with zero patients are omitted to avoid clutter. Plain text, no callout box - "n" mode is
 * just the count (no repeated "n=" prefix per bin); "n_pct" adds that bin's share of this
 * dose group's own patients, e.g. "139 (93%)".
 */
function computeSplitAnnotations(metric: ExposureMetric, dose: string, xDomain: [number, number], mode: SplitAnnotationMode): DistributionSplitAnnotation[] {
  const cutpoints = computeReferenceLines(metric).map((r) => r.value);
  if (!cutpoints.length) return [];
  const vals = RECORDS.filter((r) => r.dose === dose).map((r) => exposureValue(r, metric));
  if (!vals.length) return [];

  const binCount = cutpoints.length + 1;
  const counts = new Array(binCount).fill(0);
  vals.forEach((v) => {
    let bin = 0;
    while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
    counts[bin]++;
  });

  const out: DistributionSplitAnnotation[] = [];
  for (let i = 0; i < binCount; i++) {
    if (!counts[i]) continue;
    const lower = i === 0 ? xDomain[0] : cutpoints[i - 1];
    const upper = i === cutpoints.length ? xDomain[1] : cutpoints[i];
    const pct = Math.round((counts[i] / vals.length) * 100);
    const label = mode === "n_pct" ? `${counts[i]} (${pct}%)` : `${counts[i]}`;
    out.push({ x: (lower + upper) / 2, label });
  }
  return out;
}

/**
 * Observed (raw, non-model) response rate + 95% Wilson CI within each bin of the active
 * exposure split - plotted on the scatter panel against the fitted curve for a direct "observed
 * vs fitted" read (mirrors ggquickeda's "Observed probability by exposure split" annotation).
 * Placebo forms its own natural bin (every placebo patient has zero exposure by design); the
 * remaining bins come from the same non-placebo cut points used for the reference lines.
 */
function computeObservedResponseBins(metric: ExposureMetric, endpoint: Endpoint): ObservedResponseBin[] {
  if (!state.showObservedResponders || !state.referenceLineKind) return [];
  const cutpoints = computeReferenceLines(metric).map((r) => r.value);
  if (!cutpoints.length) return [];

  const bins: ObservedResponseBin[] = [];

  const placeboRows = RECORDS.filter((r) => r.dose === "Placebo");
  if (placeboRows.length) {
    const responders = placeboRows.filter((r) => endpointValue(r, endpoint) === 1).length;
    const ci = wilsonScoreInterval(responders, placeboRows.length);
    bins.push({ x: 0, n: placeboRows.length, responders, proportion: ci.proportion, ciLower: ci.lower, ciUpper: ci.upper });
  }

  const dosedRows = RECORDS.filter((r) => r.dose !== "Placebo");
  const binCount = cutpoints.length + 1;
  const buckets: ExposureResponseRecord[][] = Array.from({ length: binCount }, () => []);
  dosedRows.forEach((r) => {
    const v = exposureValue(r, metric);
    let bin = 0;
    while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
    buckets[bin].push(r);
  });
  buckets.forEach((rows) => {
    if (!rows.length) return;
    const responders = rows.filter((r) => endpointValue(r, endpoint) === 1).length;
    const ci = wilsonScoreInterval(responders, rows.length);
    const meanX = rows.reduce((sum, r) => sum + exposureValue(r, metric), 0) / rows.length;
    bins.push({ x: meanX, n: rows.length, responders, proportion: ci.proportion, ciLower: ci.lower, ciUpper: ci.upper });
  });

  return bins;
}

/** The active patient set is shared across every exposure panel: a brush made in one panel's
 * coordinate space still resolves to patient ids, which highlight the same patients everywhere. */
function activeSet(): Set<number> {
  let ids = new Set(RECORDS.map((r) => r.id));
  if (state.brushedIds) ids = new Set([...ids].filter((id) => state.brushedIds!.has(id)));
  if (state.selectedDoses.size) ids = new Set([...ids].filter((id) => state.selectedDoses.has(RECORDS[id].dose)));
  return ids;
}

interface ScatterMeta {
  plot: { left: number; top: number; width: number; height: number };
  xScale: { domain: [number, number]; range: [number, number] };
  yScale: { domain: [number, number]; range: [number, number] };
}

function render(): void {
  const metrics = selectedExposureMetrics();
  const endpoints = selectedEndpoints();
  const primaryEndpoint = endpoints[0] ?? "icgi";
  const active = activeSet();

  scatterPanelsEl.innerHTML = "";
  boxPanelsEl.innerHTML = "";
  distributionPanels = [];

  const comparisonEligible = metrics.length === 1 && endpoints.length > 1;
  compareEndpointsEl.disabled = !comparisonEligible;

  if (state.compareEndpoints && comparisonEligible) {
    renderEndpointComparisonRow(metrics[0], endpoints);
    endpointLegendEl.style.display = "flex";
  } else {
    // one row per endpoint, one column per exposure metric - mirrors facet_grid(Endpoint~expname)
    for (const endpoint of endpoints) {
      const rowEl = document.createElement("div");
      rowEl.className = "endpoint-row";
      const rowGrid = document.createElement("div");
      rowGrid.className = "panel-grid";
      if (endpoints.length > 1) {
        const rowLabel = document.createElement("div");
        rowLabel.className = "endpoint-row-label";
        rowLabel.textContent = endpoint.toUpperCase();
        rowEl.appendChild(rowLabel);
      }
      rowEl.appendChild(rowGrid);
      scatterPanelsEl.appendChild(rowEl);
      for (const metric of metrics) {
        renderScatterPanel(metric, endpoint, active, rowGrid);
      }
    }
    endpointLegendEl.style.display = "none";
  }

  // the exposure distribution panel doesn't depend on endpoint (dose exposure is the same
  // regardless of which response endpoint you're looking at) - it renders once per exposure
  // metric, using the first selected endpoint only for its per-dose responder count
  for (const metric of metrics) {
    renderDistributionPanel(metric, primaryEndpoint, active);
  }

  renderLegend();
  updateStatus(active.size);
  updateKpis(active.size, primaryEndpoint);
  refLineNoteEl.style.display = state.referenceLineKind ? "block" : "none";
  // the two split annotations only mean anything once a reference-line split is chosen
  splitAnnotationModeEl.disabled = !state.referenceLineKind;
  showObservedRespEl.disabled = !state.referenceLineKind;
  showReferenceFitEl.disabled = !state.referenceLineKind;
}

function renderScatterPanel(metric: ExposureMetric, endpoint: Endpoint, active: Set<number>, container: HTMLElement): void {
  const { model, xs } = fitFor(metric, endpoint);
  const xMax = Math.max(...xs);
  const curve = curveFor(model, xs, xMax, endpoint);

  const groupStats: Record<
    string,
    {
      q1: number;
      q3: number;
      median: number;
      whiskerLow: number;
      whiskerHigh: number;
      min: number;
      max: number;
      n: number;
      observed: { proportion: number; ciLower: number; ciUpper: number; n: number; responders: number };
    }
  > = {};
  for (const dose of DOSE_ORDER) {
    const doseRecords = RECORDS.filter((r) => active.has(r.id) && r.dose === dose);
    const vals = doseRecords.map((r) => exposureValue(r, metric)).sort((a, b) => a - b);
    if (!vals.length) continue;
    const s = summarizeDistribution(vals);
    if (!s) continue;
    const responders = doseRecords.filter((r) => endpointValue(r, endpoint) === 1).length;
    const ci = wilsonScoreInterval(responders, doseRecords.length);
    groupStats[dose] = {
      q1: s.q1,
      q3: s.q3,
      median: s.median,
      whiskerLow: s.whiskerLow,
      whiskerHigh: s.whiskerHigh,
      min: s.min,
      max: s.max,
      n: vals.length,
      observed: { proportion: ci.proportion, ciLower: ci.lower, ciUpper: ci.upper, n: doseRecords.length, responders }
    };
  }

  const points: ScatterPoint[] = RECORDS.map((r) => ({
    id: r.id,
    exposure: exposureValue(r, metric),
    response: endpointValue(r, endpoint),
    displayY: endpointValue(r, endpoint) + seededJitter(r.id),
    groupId: r.dose,
    label: `${exposureLabel(metric)} ${exposureValue(r, metric).toFixed(1)} · ${endpoint.toUpperCase()} ${endpointValue(r, endpoint)} · ${r.dose} · Study ${r.study}`,
    selected: active.has(r.id)
  }));

  const projected: ProjectedGroup[] = [...state.selectedDoses]
    .filter((dose) => groupStats[dose])
    .map((dose) => {
      const { observed, ...rest } = groupStats[dose]!;
      return {
        groupId: dose,
        color: DOSE_COLORS[dose] ?? "#111827",
        ...rest,
        observed: state.showDoseObserved ? observed : undefined
      };
    });

  const width = panelWidth();
  const scatterResult = renderLogisticScatterChart({
    points,
    curve,
    projected,
    groupColors: DOSE_COLORS,
    xDomain: [0, xMax],
    referenceLines: computeReferenceLines(metric),
    observedBins: computeObservedResponseBins(metric, endpoint),
    showReferenceFit: state.showReferenceFit,
    width,
    height: 360,
    options: { title: "Exposure vs response", xAxisLabel: exposureLabel(metric), yAxisLabel: endpoint.toUpperCase(), renderTarget: "svg" }
  });

  const cell = document.createElement("div");
  cell.className = "panel-cell";
  cell.innerHTML = `<div class="panel-cell-title">${exposureLabel(metric)}</div><div class="chart" data-metric="${metric}"></div>`;
  container.appendChild(cell);
  const chartWrap = cell.querySelector(".chart") as HTMLDivElement;
  chartWrap.innerHTML = scatterResult.content;
  const tip = document.createElement("div");
  tip.className = "tooltip";
  chartWrap.appendChild(tip);
  attachScatterInteractivity(chartWrap, tip, metric, endpoint, scatterResult.metadata as unknown as ScatterMeta);
}

function renderDistributionPanel(metric: ExposureMetric, endpoint: Endpoint, active: Set<number>): void {
  const xs = RECORDS.map((r) => exposureValue(r, metric));
  const xMax = Math.max(...xs);
  const xDomain: [number, number] = [0, xMax];

  const distGroups: DistributionGroupInput[] = DOSE_ORDER.slice()
    .reverse()
    .map((dose) => {
      const isPlacebo = dose === "Placebo";
      const rows = RECORDS.filter((r) => r.dose === dose);
      const values = isPlacebo ? [] : rows.map((r) => exposureValue(r, metric));
      const nResponders = rows.filter((r) => endpointValue(r, endpoint) === 1).length;
      return {
        groupId: dose,
        label: dose,
        color: DOSE_COLORS[dose],
        values,
        n: rows.length,
        nResponders,
        selected: state.selectedDoses.has(dose),
        skipShape: isPlacebo,
        splitAnnotations:
          isPlacebo || state.splitAnnotationMode === "off" ? undefined : computeSplitAnnotations(metric, dose, xDomain, state.splitAnnotationMode)
      };
    })
    .filter((g) => g.n > 0);

  const width = panelWidth();
  const distResult = renderDistributionChart({
    groups: distGroups,
    xDomain: [0, xMax],
    mode: state.distributionMode,
    referenceLines: computeReferenceLines(metric),
    width,
    height: 280,
    options: { title: "Exposure by dose", xAxisLabel: exposureLabel(metric), yAxisLabel: "", renderTarget: "svg" }
  });

  const cell = document.createElement("div");
  cell.className = "panel-cell";
  cell.innerHTML = `<div class="panel-cell-title">${exposureLabel(metric)}</div><div class="chart box"></div><div class="readout"><span class="muted">Click a row above to show projected fit values at Min, Q1, Median, Q3, and Max.</span></div>`;
  boxPanelsEl.appendChild(cell);
  const chartWrap = cell.querySelector(".chart") as HTMLDivElement;
  const readoutEl = cell.querySelector(".readout") as HTMLDivElement;
  chartWrap.innerHTML = distResult.content;
  attachDistributionInteractivity(chartWrap, metric, endpoint, active, readoutEl, distResult.metadata as unknown as DistributionMeta);
}

interface DistributionMeta {
  xScale: { domain: [number, number]; range: [number, number] };
  groups: DistributionGroupMeta[];
  boxHalfHeightPx: number;
}

/**
 * Optional alternate view (only offered with exactly one exposure metric and 2+ endpoints
 * selected): instead of one dose-colored row per endpoint, render one panel per endpoint -
 * colored and dashed by endpoint instead of dose - plus a final "(all)" panel overlaying every
 * endpoint's curve/band/observed-marker together. No raw scatter points here (too cluttered with
 * several endpoints layered at once); the focus is purely on comparing the fitted curves.
 */
function renderEndpointComparisonRow(metric: ExposureMetric, endpoints: Endpoint[]): void {
  renderEndpointLegend(endpoints);

  const xMax = Math.max(...RECORDS.map((r) => exposureValue(r, metric)));
  const referenceLines = computeReferenceLines(metric);

  const rowEl = document.createElement("div");
  rowEl.className = "endpoint-row";
  const rowGrid = document.createElement("div");
  rowGrid.className = "panel-grid";
  rowEl.appendChild(rowGrid);
  scatterPanelsEl.appendChild(rowEl);

  const width = Math.max(340, Math.floor(1200 / (endpoints.length + 1)));

  const fits = endpoints.map((endpoint) => {
    const { model, xs } = fitFor(metric, endpoint);
    const curve = curveFor(model, xs, xMax, endpoint);
    const observedBins: ObservedResponseBin[] = computeObservedResponseBins(metric, endpoint).map((b) => ({
      ...b,
      color: ENDPOINT_COLORS[endpoint]
    }));
    return { endpoint, curve, observedBins };
  });

  const appendPanel = (title: string, content: string) => {
    const cell = document.createElement("div");
    cell.className = "panel-cell";
    cell.innerHTML = `<div class="panel-cell-title">${title}</div><div class="chart"></div>`;
    rowGrid.appendChild(cell);
    (cell.querySelector(".chart") as HTMLDivElement).innerHTML = content;
  };

  fits.forEach(({ endpoint, curve, observedBins }) => {
    const result = renderLogisticScatterChart({
      points: [],
      curve,
      groupColors: {},
      xDomain: [0, xMax],
      referenceLines,
      observedBins,
      showReferenceFit: state.showReferenceFit,
      curveColor: ENDPOINT_COLORS[endpoint],
      curveDash: ENDPOINT_DASH[endpoint],
      bandColor: ENDPOINT_COLORS[endpoint],
      width,
      height: 360,
      options: { title: "x", xAxisLabel: exposureLabel(metric), yAxisLabel: "Response", renderTarget: "svg" }
    });
    appendPanel(endpoint.toUpperCase(), result.content);
  });

  const [first, ...rest] = fits;
  if (first) {
    const extraCurves: ExtraCurve[] = rest.map((f) => ({ curve: f.curve, color: ENDPOINT_COLORS[f.endpoint], dash: ENDPOINT_DASH[f.endpoint] }));
    const allObservedBins = fits.flatMap((f) => f.observedBins);
    const result = renderLogisticScatterChart({
      points: [],
      curve: first.curve,
      groupColors: {},
      xDomain: [0, xMax],
      referenceLines,
      observedBins: allObservedBins,
      curveColor: ENDPOINT_COLORS[first.endpoint],
      curveDash: ENDPOINT_DASH[first.endpoint],
      bandColor: ENDPOINT_COLORS[first.endpoint],
      extraCurves,
      width,
      height: 360,
      options: { title: "x", xAxisLabel: exposureLabel(metric), yAxisLabel: "Response", renderTarget: "svg" }
    });
    appendPanel("(all)", result.content);
  }
}

function renderEndpointLegend(endpoints: Endpoint[]): void {
  endpointLegendEl.innerHTML = "";
  endpoints.forEach((endpoint) => {
    const item = document.createElement("div");
    item.className = "dotKey";
    const color = ENDPOINT_COLORS[endpoint];
    const dash = ENDPOINT_DASH[endpoint];
    item.innerHTML = `<svg width="24" height="10" style="flex:none"><line x1="1" y1="5" x2="23" y2="5" stroke="${color}" stroke-width="2.4" stroke-dasharray="${dash}" stroke-linecap="round" /></svg> ${endpoint.toUpperCase()}`;
    endpointLegendEl.appendChild(item);
  });
}

function renderLegend(): void {
  legendEl.innerHTML = "";
  for (const dose of DOSE_ORDER) {
    const item = document.createElement("div");
    item.className = "dotKey";
    item.innerHTML = `<span class="swatch" style="background:${DOSE_COLORS[dose]}"></span> ${dose}`;
    legendEl.appendChild(item);
  }
}

function updateStatus(activeCount: number): void {
  const total = RECORDS.length;
  // color each dose name to match its swatch/marker color, so it's easy to tell which
  // highlighted dose is which at a glance, consistent with the rest of the UI
  const doseNamesHtml = [...state.selectedDoses]
    .map((dose) => `<strong style="color:${DOSE_COLORS[dose] ?? "#111827"}">${dose}</strong>`)
    .join(", ");
  const focusHtml = state.selectedDoses.size ? `dose = ${doseNamesHtml}` : "";
  const brushText = state.brushedIds ? `${state.brushedIds.size} brushed` : "";
  if (!state.brushedIds && !state.selectedDoses.size) {
    statusEl.textContent = "Showing all rows";
  } else {
    statusEl.innerHTML = [brushText, focusHtml].filter(Boolean).join(" and ") + ` (${activeCount} of ${total} rows)`;
  }
}

function updateKpis(activeCount: number, primaryEndpoint: Endpoint): void {
  kpiN.textContent = String(RECORDS.length);
  const responders = RECORDS.filter((r) => endpointValue(r, primaryEndpoint) === 1).length;
  kpiResponders.textContent = `${responders} (${((responders / RECORDS.length) * 100).toFixed(0)}%)`;
  if (kpiRespondersLabel) kpiRespondersLabel.textContent = `Responders (${primaryEndpoint.toUpperCase()})`;
  kpiShowing.textContent = String(activeCount);
}

function updateReadout(readoutEl: HTMLDivElement, metric: ExposureMetric, endpoint: Endpoint, active: Set<number>): void {
  const groupStats: Record<string, { min: number; q1: number; median: number; q3: number; max: number }> = {};
  for (const dose of state.selectedDoses) {
    const vals = RECORDS.filter((r) => active.has(r.id) && r.dose === dose)
      .map((r) => exposureValue(r, metric))
      .sort((a, b) => a - b);
    const s = summarizeDistribution(vals);
    if (s) groupStats[dose] = { min: s.min, q1: s.q1, median: s.median, q3: s.q3, max: s.max };
  }
  const doses = [...state.selectedDoses].filter((d) => groupStats[d]);
  if (!doses.length) {
    readoutEl.innerHTML = '<span class="muted">Click a box above to show projected fit values at Min, Q1, Median, Q3, and Max.</span>';
    return;
  }
  const { model } = fitFor(metric, endpoint);
  const lines = doses.map((dose) => {
    const g = groupStats[dose];
    const fitAt = (x: number) => 1 / (1 + Math.exp(-(model.intercept + model.slope * x)));
    return `<div><strong style="color:${DOSE_COLORS[dose] ?? "#111827"}">${dose}</strong> &nbsp; Min ${exposureLabel(metric)} = ${g.min.toFixed(1)} (fit ${fitAt(g.min).toFixed(3)}) &nbsp; Q1 = ${g.q1.toFixed(1)} (fit ${fitAt(g.q1).toFixed(3)}) &nbsp; Median = ${g.median.toFixed(1)} (fit ${fitAt(g.median).toFixed(3)}) &nbsp; Q3 = ${g.q3.toFixed(1)} (fit ${fitAt(g.q3).toFixed(3)}) &nbsp; Max = ${g.max.toFixed(1)} (fit ${fitAt(g.max).toFixed(3)})</div>`;
  });
  readoutEl.innerHTML = lines.join("");
}

function attachScatterInteractivity(chartWrap: HTMLDivElement, tip: HTMLDivElement, metric: ExposureMetric, endpoint: Endpoint, meta: ScatterMeta): void {
  const svg = chartWrap.querySelector("svg");
  if (!svg) return;
  const x = scaleLinear(meta.xScale.domain, meta.xScale.range);
  const y = scaleLinear(meta.yScale.domain, meta.yScale.range);

  svg.addEventListener("pointermove", (ev) => {
    const target = (ev.target as Element).closest("circle[data-id]") as SVGCircleElement | null;
    if (!target) {
      tip.style.opacity = "0";
      return;
    }
    const rectBounds = chartWrap.getBoundingClientRect();
    tip.style.left = `${ev.clientX - rectBounds.left}px`;
    tip.style.top = `${ev.clientY - rectBounds.top}px`;
    tip.style.opacity = "1";
    const exposure = target.getAttribute("data-exposure");
    const response = target.getAttribute("data-response");
    const group = target.getAttribute("data-group");
    tip.innerHTML = `${exposureLabel(metric)}: ${Number(exposure).toFixed(1)}<br>${endpoint.toUpperCase()}: ${response}<br>Dose: ${group}`;
  });
  svg.addEventListener("pointerleave", () => (tip.style.opacity = "0"));

  const viewBox = svg.viewBox.baseVal;
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  overlay.setAttribute("x", String(meta.plot.left));
  overlay.setAttribute("y", String(meta.plot.top));
  overlay.setAttribute("width", String(meta.plot.width));
  overlay.setAttribute("height", String(meta.plot.height));
  overlay.setAttribute("fill", "transparent");
  overlay.setAttribute("cursor", "crosshair");
  svg.appendChild(overlay);

  let drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let brushRectEl: SVGRectElement | null = null;

  const toSvgPoint = (ev: PointerEvent): { sx: number; sy: number } => {
    const bounds = svg.getBoundingClientRect();
    const sx = ((ev.clientX - bounds.left) / bounds.width) * viewBox.width;
    const sy = ((ev.clientY - bounds.top) / bounds.height) * viewBox.height;
    return { sx, sy };
  };

  overlay.addEventListener("pointerdown", (ev) => {
    const { sx, sy } = toSvgPoint(ev as PointerEvent);
    drag = { x0: sx, y0: sy, x1: sx, y1: sy };
    overlay.setPointerCapture((ev as PointerEvent).pointerId);
  });
  overlay.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const { sx, sy } = toSvgPoint(ev as PointerEvent);
    drag.x1 = sx;
    drag.y1 = sy;
    if (brushRectEl) brushRectEl.remove();
    brushRectEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    brushRectEl.setAttribute("x", String(Math.min(drag.x0, drag.x1)));
    brushRectEl.setAttribute("y", String(Math.min(drag.y0, drag.y1)));
    brushRectEl.setAttribute("width", String(Math.abs(drag.x1 - drag.x0)));
    brushRectEl.setAttribute("height", String(Math.abs(drag.y1 - drag.y0)));
    brushRectEl.setAttribute("fill", "rgba(37,99,235,0.10)");
    brushRectEl.setAttribute("stroke", "rgba(37,99,235,0.85)");
    brushRectEl.setAttribute("stroke-dasharray", "5 4");
    svg.appendChild(brushRectEl);
  });
  overlay.addEventListener("pointerup", () => {
    if (!drag) return;
    const dx = Math.abs(drag.x1 - drag.x0);
    const dy = Math.abs(drag.y1 - drag.y0);
    if (dx < 4 && dy < 4) {
      state.brushedIds = null;
      drag = null;
      if (brushRectEl) brushRectEl.remove();
      render();
      return;
    }
    const minExposure = x.invert(Math.min(drag.x0, drag.x1));
    const maxExposure = x.invert(Math.max(drag.x0, drag.x1));
    const minY = y.invert(Math.max(drag.y0, drag.y1));
    const maxY = y.invert(Math.min(drag.y0, drag.y1));
    const selected = RECORDS.filter((r) => {
      const ex = exposureValue(r, metric);
      const disp = endpointValue(r, endpoint) + seededJitter(r.id);
      return ex >= minExposure && ex <= maxExposure && disp >= minY && disp <= maxY;
    });
    state.brushedIds = new Set(selected.map((r) => r.id));
    drag = null;
    render();
  });
}

function attachDistributionInteractivity(
  chartWrap: HTMLDivElement,
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  readoutEl: HTMLDivElement,
  meta: DistributionMeta
): void {
  const svg = chartWrap.querySelector("svg");
  updateReadout(readoutEl, metric, endpoint, active);
  if (!svg) return;

  const rows = svg.querySelectorAll<SVGGElement>("g.er-ridge");
  const pathEls: (SVGPathElement | null)[] = [];
  const capEls: (SVGGElement | null)[] = [];
  rows.forEach((g) => {
    pathEls.push(g.querySelector<SVGPathElement>("path.er-ridge-shape"));
    capEls.push(g.querySelector<SVGGElement>("g.er-caps"));
    g.addEventListener("click", () => {
      const dose = g.getAttribute("data-group");
      if (!dose || distributionAnimating) return;
      if (state.selectedDoses.has(dose)) state.selectedDoses.delete(dose);
      else state.selectedDoses.add(dose);
      render();
    });
  });

  distributionPanels.push({
    xScale: scaleLinear(meta.xScale.domain, meta.xScale.range),
    groups: meta.groups,
    boxHalfHeightPx: meta.boxHalfHeightPx,
    pathEls,
    capEls
  });
}

/* ---------------------------------------------------------------------- *
 * Boxplot <-> distribution (violin) morph transition
 * ---------------------------------------------------------------------- */

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Top/bottom pixel offsets (from `cy`) for one distribution group in a given mode. Boxplot is
 * a fully mirrored ridge (top === bottom); distribution is a "half violin" - only the top edge
 * traces the density curve, while the bottom edge sits flush on a flat baseline (reusing the
 * box's own half-height, so the shape's bottom edge doesn't move during the morph). */
function topBottomFor(mode: DistributionMode, g: DistributionGroupMeta, boxHalfHeightPx: number): { top: number[]; bottom: number[] } {
  if (mode === "boxplot") return { top: g.boxHalfHeights, bottom: g.boxHalfHeights };
  return { top: g.densityHalfHeights, bottom: g.densityHalfHeights.map(() => boxHalfHeightPx) };
}

function transitionDistributionMode(targetMode: DistributionMode): void {
  if (distributionAnimating || targetMode === state.distributionMode) return;
  const fromMode = state.distributionMode;
  distributionAnimating = true;
  setDistModeButtonsDisabled(true);
  setDistModeButtonsActive(targetMode);

  const duration = 480;
  const start = performance.now();
  const panels = distributionPanels;
  const fromCapOpacity = fromMode === "boxplot" ? 1 : 0;
  const toCapOpacity = targetMode === "boxplot" ? 1 : 0;

  function frame(now: number): void {
    const t = Math.min(1, (now - start) / duration);
    const e = easeInOutCubic(t);
    for (const panel of panels) {
      panel.groups.forEach((g, i) => {
        const pathEl = panel.pathEls[i];
        if (pathEl) {
          const from = topBottomFor(fromMode, g, panel.boxHalfHeightPx);
          const to = topBottomFor(targetMode, g, panel.boxHalfHeightPx);
          const top = from.top.map((v, j) => v + (to.top[j] - v) * e);
          const bottom = from.bottom.map((v, j) => v + (to.bottom[j] - v) * e);
          pathEl.setAttribute("d", buildAsymRidgePath(g.xSamples, top, bottom, panel.xScale, g.cy));
        }
        const capEl = panel.capEls[i];
        if (capEl) capEl.setAttribute("opacity", String(fromCapOpacity + (toCapOpacity - fromCapOpacity) * e));
      });
    }
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      state.distributionMode = targetMode;
      distributionAnimating = false;
      setDistModeButtonsDisabled(false);
      render();
    }
  }
  requestAnimationFrame(frame);
}

function setDistModeButtonsDisabled(disabled: boolean): void {
  distModeGroupEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = disabled));
}

function setDistModeButtonsActive(mode: DistributionMode): void {
  distModeGroupEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

function resetSelection(): void {
  state.brushedIds = null;
  state.selectedDoses.clear();
  render();
}

/* ---------------------------------------------------------------------- *
 * Session save / load
 * ---------------------------------------------------------------------- */

function buildSessionState(): SessionState {
  const metrics = selectedExposureMetrics();
  const endpoints = selectedEndpoints();
  const primaryMetric = metrics[0] ?? "auc";
  const primaryEndpoint = endpoints[0] ?? "icgi";
  const model = createModelDefinition(
    `${primaryEndpoint}-${primaryMetric}-logistic`,
    "logistic",
    `Logistic exposure-response: ${primaryEndpoint.toUpperCase()} ~ ${exposureLabel(primaryMetric)}${
      metrics.length > 1 ? ` (+${metrics.length - 1} more exposure panel(s))` : ""
    }${endpoints.length > 1 ? ` (+${endpoints.length - 1} more endpoint row(s))` : ""}`
  );
  const { model: fit, xs } = fitFor(primaryMetric, primaryEndpoint);
  const xMax = Math.max(...xs);
  const curve = curveFor(fit, xs, xMax, primaryEndpoint);
  const visualization = createVisualizationSpec(`${DATASET_ID}-scatter`, model, curve, {
    title: "Exposure vs response",
    xAxisLabel: exposureLabel(primaryMetric),
    yAxisLabel: primaryEndpoint.toUpperCase(),
    renderTarget: "svg"
  });
  return createSessionState(
    DATASET_ID,
    model,
    visualization,
    {
      brushedIds: state.brushedIds ? [...state.brushedIds] : null,
      selectedDoses: [...state.selectedDoses]
    },
    {
      exposureMetrics: metrics,
      endpoints,
      ciMethod: state.ciMethod,
      bootstrapSeed: state.bootstrapSeed,
      bootstrapResamples: state.bootstrapResamples,
      distributionMode: state.distributionMode,
      referenceLineKind: state.referenceLineKind,
      splitAnnotationMode: state.splitAnnotationMode,
      showObservedResponders: state.showObservedResponders,
      showReferenceFit: state.showReferenceFit,
      showDoseObserved: state.showDoseObserved,
      compareEndpoints: state.compareEndpoints
    }
  );
}

function saveSession(): void {
  const session = buildSessionState();
  const json = serializeSession(session);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `er-explorer-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  sessionStatus.textContent = "Session saved.";
}

function setExposureCheckboxes(metrics: ExposureMetric[]): void {
  exposureGroupEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.checked = metrics.includes(cb.value as ExposureMetric);
  });
}

function setEndpointCheckboxes(endpoints: Endpoint[]): void {
  endpointGroupEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.checked = endpoints.includes(cb.value as Endpoint);
  });
}

function setRefLineRadio(kind: ReferenceLineKind | null): void {
  refLineGroupEl.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((rb) => {
    rb.checked = rb.value === (kind ?? "none");
  });
}

function loadSessionFromFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const session = parseSession(String(reader.result));
      const ci = session.settings["ciMethod"];
      const metricsRaw = session.settings["exposureMetrics"];
      // fall back to the older single-exposure session format for backward compatibility
      const legacyMetric = session.settings["exposureMetric"];
      let metrics: ExposureMetric[] = [];
      if (Array.isArray(metricsRaw)) {
        metrics = metricsRaw.filter((m): m is ExposureMetric => m === "auc" || m === "cmax");
      } else if (legacyMetric === "auc" || legacyMetric === "cmax") {
        metrics = [legacyMetric];
      }
      if (!metrics.length) metrics = ["auc"];
      state.exposureMetrics = new Set(metrics);

      const endpointsRaw = session.settings["endpoints"];
      // fall back to the older single-endpoint session format for backward compatibility
      const legacyEndpoint = session.settings["endpoint"];
      let endpoints: Endpoint[] = [];
      if (Array.isArray(endpointsRaw)) {
        endpoints = endpointsRaw.filter((e): e is Endpoint => e === "icgi" || e === "icgi2" || e === "icgi3");
      } else if (legacyEndpoint === "icgi" || legacyEndpoint === "icgi2" || legacyEndpoint === "icgi3") {
        endpoints = [legacyEndpoint];
      }
      if (!endpoints.length) endpoints = ["icgi"];
      state.endpoints = new Set(endpoints);

      if (ci === "wald" || ci === "bootstrap") state.ciMethod = ci;
      if (typeof session.settings["bootstrapSeed"] === "number") state.bootstrapSeed = session.settings["bootstrapSeed"] as number;
      if (typeof session.settings["bootstrapResamples"] === "number") state.bootstrapResamples = session.settings["bootstrapResamples"] as number;
      const distMode = session.settings["distributionMode"];
      if (distMode === "boxplot" || distMode === "violin") state.distributionMode = distMode;
      const refKindRaw = session.settings["referenceLineKind"];
      // fall back to the older multi-select session format for backward compatibility
      const legacyRefKinds = session.settings["referenceLineKinds"];
      let refKind: ReferenceLineKind | null = null;
      if (refKindRaw === "median" || refKindRaw === "tertiles" || refKindRaw === "quartiles") {
        refKind = refKindRaw;
      } else if (Array.isArray(legacyRefKinds) && legacyRefKinds.length) {
        const first = legacyRefKinds[0];
        if (first === "median" || first === "tertiles" || first === "quartiles") refKind = first;
      }
      state.referenceLineKind = refKind;
      const splitModeRaw = session.settings["splitAnnotationMode"];
      // fall back to the older boolean session format for backward compatibility
      const legacyShowSplitCounts = session.settings["showSplitCounts"];
      if (splitModeRaw === "off" || splitModeRaw === "n" || splitModeRaw === "n_pct") {
        state.splitAnnotationMode = splitModeRaw;
      } else {
        state.splitAnnotationMode = legacyShowSplitCounts === true ? "n" : "off";
      }
      state.showObservedResponders = session.settings["showObservedResponders"] === true;
      state.showReferenceFit = session.settings["showReferenceFit"] === true;
      // default true (matches the app's default) so older session files without this key still
      // show the dose-observed marker rather than silently hiding it
      state.showDoseObserved = session.settings["showDoseObserved"] !== false;
      state.compareEndpoints = session.settings["compareEndpoints"] === true;
      const brushed = session.filters["brushedIds"];
      state.brushedIds = Array.isArray(brushed) ? new Set(brushed as number[]) : null;
      const doses = session.filters["selectedDoses"];
      state.selectedDoses = new Set(Array.isArray(doses) ? (doses as string[]) : []);

      setExposureCheckboxes(metrics);
      setEndpointCheckboxes(endpoints);
      ciSelect.value = state.ciMethod;
      setDistModeButtonsActive(state.distributionMode);
      setRefLineRadio(state.referenceLineKind);
      splitAnnotationModeEl.value = state.splitAnnotationMode;
      showObservedRespEl.checked = state.showObservedResponders;
      showReferenceFitEl.checked = state.showReferenceFit;
      showDoseObservedEl.checked = state.showDoseObserved;
      compareEndpointsEl.checked = state.compareEndpoints;
      render();
      sessionStatus.textContent = `Loaded session from ${session.metadata.createdAt}.`;
    } catch (err) {
      const message = err instanceof InvalidSessionFileError ? err.message : "Could not read this file as a session.";
      sessionStatus.textContent = `Load failed: ${message}`;
    }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------------- *
 * Wiring
 * ---------------------------------------------------------------------- */

exposureGroupEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
  cb.addEventListener("change", () => {
    const checked = new Set(
      [...exposureGroupEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")].map((el) => el.value as ExposureMetric)
    );
    if (checked.size === 0) {
      // keep at least one exposure selected; revert this checkbox
      cb.checked = true;
      return;
    }
    state.exposureMetrics = checked;
    state.brushedIds = null;
    render();
  });
});
refLineGroupEl.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((rb) => {
  rb.addEventListener("change", () => {
    state.referenceLineKind = rb.value === "none" ? null : (rb.value as ReferenceLineKind);
    render();
  });
});
splitAnnotationModeEl.addEventListener("change", () => {
  const val = splitAnnotationModeEl.value;
  state.splitAnnotationMode = val === "n" || val === "n_pct" ? val : "off";
  render();
});
showObservedRespEl.addEventListener("change", () => {
  state.showObservedResponders = showObservedRespEl.checked;
  render();
});
showReferenceFitEl.addEventListener("change", () => {
  state.showReferenceFit = showReferenceFitEl.checked;
  render();
});
showDoseObservedEl.addEventListener("change", () => {
  state.showDoseObserved = showDoseObservedEl.checked;
  render();
});
compareEndpointsEl.addEventListener("change", () => {
  state.compareEndpoints = compareEndpointsEl.checked;
  render();
});
endpointGroupEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
  cb.addEventListener("change", () => {
    const checked = new Set(
      [...endpointGroupEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")].map((el) => el.value as Endpoint)
    );
    if (checked.size === 0) {
      // keep at least one endpoint selected; revert this checkbox
      cb.checked = true;
      return;
    }
    state.endpoints = checked;
    state.brushedIds = null;
    render();
  });
});
ciSelect.addEventListener("change", () => {
  state.ciMethod = ciSelect.value as CIMethod;
  render();
});
distModeGroupEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode as DistributionMode | undefined;
    if (mode) transitionDistributionMode(mode);
  });
});
resetBtn.addEventListener("click", resetSelection);
saveSessionBtn.addEventListener("click", saveSession);
loadSessionBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadSessionFromFile(file);
  fileInput.value = "";
});

render();
