import {
  fitLogisticModel,
  predictLogisticWaldResult,
  bootstrapLogisticCI,
  summarizeDistribution,
  kernelDensityEstimate,
  silvermanBandwidth,
  quantile,
  wilsonScoreInterval,
  createModelDefinition,
  type LogisticModel,
  type PredictionResult
} from "@er-explorer/analysis";
import { linearAnalysisModel, meanConfidenceInterval, type LinearParams } from "@er-explorer/model-linear";
import {
  SVGRenderer,
  GridLayer,
  AxisLayer,
  ScatterLayer,
  FitLayer,
  ConfidenceRibbonLayer,
  ObservedStatLayer,
  AnnotationLayer,
  DoseProjectionLayer,
  DistributionLayer,
  interpolateCurveSample,
  buildAsymRidgePath,
  scaleLinear,
  type Layer as RendererLayer,
  type Scale,
  type CurveSample,
  type ScatterPointDatum,
  type ReferenceLineSpec,
  type DistributionGroupDatum,
  type DistributionGroupMeta,
  type DistributionMode,
  type DistributionSplitAnnotation,
  type DistributionLayerData
} from "@er-explorer/renderer";
import {
  createSessionState,
  serializeSession,
  parseSession,
  createVisualizationSpec,
  InvalidSessionFileError,
  type SessionState
} from "@er-explorer/session-engine";
import { RECORDS } from "./data.generated";
import { parseCsv } from "./csvParse";
import {
  type DemoColumnRole,
  DEMO_COLUMN_ROLES,
  EFFICGI_DEFAULT_ROLES,
  looksLikePkExposureColumn
} from "./columnMapping";
import {
  DatasetContext,
  type EndpointId,
  type MetricId,
  inferRolesForColumns,
  buildPendingContext,
  rowsFromLoaded
} from "./datasetContext";
import { loadDataset } from "@er-explorer/data";
import {
  type ByodSessionPayload,
  buildByodPayload,
  verifySnapshotChecksum
} from "./datasetSnapshot";
import { initAppShell, setPlotWorkspaceVisible, setShellRail } from "./appShell";
import { mountSortableFieldList } from "./sortableFieldList";
import {
  type EndpointAnalysisModel,
  type EndpointNormScale,
  dataRangeForEndpoint,
  inferDefaultEndpointModel,
  mapCurveToCompareScale,
  normToCompareScale,
  resolveNormBounds
} from "./endpointAnalysis";
import {
  type DataFilterRule,
  type FilterOperator,
  distinctColumnValues,
  filterOperatorsForColumn,
  listFilterColumns,
  rowMatchesFilter,
  describeActiveFilters
} from "./dataFilters";
import { applyMetricStackHeight, applyScatterPaneRatio, attachFacetBlockSplitter, attachMetricStackSplitter, attachPlotStackHeightResizer, loadMetricStackHeight, loadScatterPaneRatio, saveMetricStackHeight, saveScatterPaneRatio } from "./paneSplit";

/**
 * Chart-input data shapes formerly imported from the now-deleted
 * `packages/visualization-engine` (Phase 7 of the renderer migration -
 * `docs/RENDERER_ARCHITECTURE.md` §8). These are purely this app's own internal data-prep
 * vocabulary now - no rendering package's public contract depends on them anymore, since Phases
 * 4-6 each built their own bespoke, purpose-specific input types
 * (`BinaryCurveOverlay`/`ReferenceLineSpec`/`ObservedStatBin`/`DistributionGroupDatum`/etc.).
 */
interface ScatterPoint {
  id: string | number;
  exposure: number;
  response: number;
  displayY?: number;
  groupId: string | number;
  label?: string;
  selected?: boolean;
}

interface ProjectedGroup {
  groupId: string | number;
  color: string;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  min?: number;
  max?: number;
  observed?: { proportion: number; ciLower: number; ciUpper: number; n: number; responders: number };
  observedMean?: {
    mean: number;
    ciLower: number;
    ciUpper: number;
    n: number;
    primaryLabel?: string;
    secondaryLabel?: string;
  };
}

interface LinearProjectedGroup {
  groupId: string | number;
  color: string;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  min?: number;
  max?: number;
  observedMean?: { mean: number; ciLower: number; ciUpper: number; n: number };
}

interface ObservedResponseBin {
  x: number;
  proportion: number;
  ciLower: number;
  ciUpper: number;
  n: number;
  responders: number;
  color?: string;
  strokeDash?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

interface ObservedMeanBin {
  x: number;
  mean: number;
  ciLower: number;
  ciUpper: number;
  n: number;
  color?: string;
}

/** A vertical reference line drawn at a fixed exposure value (e.g. a global median/tertile/quartile). */
interface ReferenceLine {
  value: number;
  label: string;
}

/** Deterministic pseudo-jitter (by index) so repeated renders of the same dataset are
 * pixel-stable. */
function seededJitter(index: number, amplitude = 0.09): number {
  const s = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2 * amplitude;
}

type ExposureMetric = MetricId;
type Endpoint = EndpointId;
type CIMethod = "wald" | "bootstrap" | "none";

let dataset: DatasetContext | null = null;

function requireDataset(): DatasetContext {
  if (!dataset) throw new Error("No dataset loaded");
  return dataset;
}

const ENDPOINT_COLOR_PALETTE = ["#4C72B0", "#DDAA33", "#C44E52", "#55A868", "#8172B2", "#CCB974", "#64B5CD"];
const ENDPOINT_DASH_PATTERNS = ["", "8 5", "10 4", "6 4", "4 6", "6 3 2 3", "3 5"];

type ColorSchemeId = "default" | "tableau" | "set2" | "dark";
type GridLayout = "endpoint-rows" | "exposure-rows";

const COLOR_SCHEME_PALETTES: Record<Exclude<ColorSchemeId, "default">, string[]> = {
  tableau: ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7"],
  set2: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"],
  dark: ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2", "#ea580c", "#4b5563"]
};

function paletteColor(scheme: Exclude<ColorSchemeId, "default">, order: string[], key: string): string {
  const palette = COLOR_SCHEME_PALETTES[scheme];
  const idx = order.indexOf(key);
  return palette[(idx >= 0 ? idx : 0) % palette.length];
}

/** Legacy effICGI endpoint styling when column ids match. */
const ENDPOINT_COLORS: Record<string, string> = {
  icgi: "#4C72B0",
  icgi2: "#DDAA33",
  icgi3: "#C44E52",
  brls: "#55A868",
  prls: "#8172B2"
};
const ENDPOINT_DASH: Record<string, string> = {
  icgi: "",
  icgi2: "2 4",
  icgi3: "9 4",
  brls: "4 3",
  prls: "8 5"
};

/** Stronger dash on observed-stat label boxes (compare mode, neutral fills). */
function endpointMarkerDash(endpoint: EndpointId): string | undefined {
  const d = endpointDash(endpoint);
  return d.length ? d : undefined;
}

function endpointColor(endpoint: EndpointId): string {
  const ds = requireDataset();
  if (state.endpointColorScheme === "default") {
    if (ENDPOINT_COLORS[endpoint]) return ENDPOINT_COLORS[endpoint];
    const order = ds.endpointOrder();
    const idx = order.indexOf(endpoint);
    return ENDPOINT_COLOR_PALETTE[(idx >= 0 ? idx : order.length) % ENDPOINT_COLOR_PALETTE.length];
  }
  return paletteColor(state.endpointColorScheme, ds.endpointOrder(), endpoint);
}

function endpointDash(endpoint: EndpointId): string {
  if (ENDPOINT_DASH[endpoint] !== undefined) return ENDPOINT_DASH[endpoint];
  const order = requireDataset().endpointOrder();
  const idx = order.indexOf(endpoint);
  return ENDPOINT_DASH_PATTERNS[(idx >= 0 ? idx : 0) % ENDPOINT_DASH_PATTERNS.length];
}

function mergeColumnOrder(preferred: string[], fromDataset: string[]): string[] {
  const kept = preferred.filter((id) => fromDataset.includes(id));
  const added = fromDataset.filter((id) => !kept.includes(id));
  return [...kept, ...added];
}

function exposureOrder(): MetricId[] {
  const fromDs = dataset?.exposureOrder() ?? [];
  if (!fromDs.length) return [];
  return mergeColumnOrder(state.exposureColumnOrder, fromDs);
}

function endpointOrder(): EndpointId[] {
  const fromDs = dataset?.endpointOrder() ?? [];
  if (!fromDs.length) return [];
  return mergeColumnOrder(state.endpointColumnOrder, fromDs);
}

function DOSE_ORDER(): string[] {
  return requireDataset().doseOrder();
}

function DOSE_COLORS(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DOSE_ORDER()) out[d] = resolveDoseColor(d);
  return out;
}

function isContinuousEndpoint(endpoint: Endpoint): boolean {
  return usesLinearModel(endpoint);
}

function usesLinearModel(endpoint: Endpoint): boolean {
  if (!dataset) return false;
  const model = state.endpointModels[endpoint] ?? inferDefaultEndpointModel(dataset, endpoint);
  return model === "linear";
}

function ensureEndpointAnalysisDefaults(): void {
  if (!dataset) return;
  for (const e of endpointOrder()) {
    if (!state.endpointModels[e]) {
      state.endpointModels[e] = inferDefaultEndpointModel(dataset, e);
    }
  }
  for (const e of endpointOrder()) {
    if (state.endpointModels[e] === "linear") ensureNormScaleForEndpoint(e);
  }
}

function ensureNormScaleForEndpoint(endpoint: Endpoint): void {
  if (!dataset) return;
  const range = dataRangeForEndpoint(dataset, endpoint);
  if (!range) return;
  let scale = state.endpointNormScales[endpoint];
  if (!scale) {
    state.endpointNormScales[endpoint] = { min: range.min, max: range.max, useCustomBounds: false };
    return;
  }
  if (!scale.useCustomBounds) {
    scale.min = range.min;
    scale.max = range.max;
  }
}

function getCompareNormBounds(endpoint: Endpoint): { min: number; max: number; valid: boolean } {
  if (!dataset) return { min: 0, max: 1, valid: false };
  const range = dataRangeForEndpoint(dataset, endpoint);
  return resolveNormBounds(state.endpointNormScales[endpoint], range);
}

function normCompareValue(y: number, endpoint: Endpoint): number {
  if (!usesLinearModel(endpoint)) return y;
  const { min, max, valid } = getCompareNormBounds(endpoint);
  if (!valid) return NaN;
  return normToCompareScale(y, min, max);
}

function isPlaceboDose(dose: string): boolean {
  if (state.referenceArmDoses.length) {
    return state.referenceArmDoses.some((a) => a.toLowerCase() === dose.toLowerCase());
  }
  return requireDataset().isPlaceboDose(dose);
}

/** PK-like exposures: reference arm ~0 on x; non-PK (wt, age): all dose groups on x. */
function exposureIsPkMetric(metric: ExposureMetric): boolean {
  if (looksLikePkExposureColumn(metric)) return true;
  const placeboRows = rowIndicesPlacebo();
  if (!placeboRows.length) return false;
  const vals = placeboRows.map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
  if (!vals.length) return true;
  return Math.max(...vals) <= 1e-6;
}

function exposureXDomain(metric: ExposureMetric): [number, number] {
  const xs = dataFilteredRowIndices().map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
  if (!xs.length) return [0, 1];
  const hi = Math.max(...xs);
  if (exposureIsPkMetric(metric)) return [0, hi];
  const lo = Math.min(...xs);
  const pad = Math.max((hi - lo) * 0.04, 0.5);
  return [lo - pad, hi + pad];
}

function inferDefaultReferenceArmDoses(): string[] {
  const ds = requireDataset();
  return ds.doseOrder().filter((d) => ds.isPlaceboDose(d));
}

function syncReferenceArmUi(): void {
  const labels = state.referenceArmDoses.length ? state.referenceArmDoses : inferDefaultReferenceArmDoses();
  referenceArmDosesEl.value = labels.join(", ");
}

function rowIndicesForDose(dose: string): number[] {
  const ds = requireDataset();
  const out: number[] = [];
  const allowed = new Set(dataFilteredRowIndices());
  for (let i = 0; i < ds.rowCount; i++) {
    if (ds.doseLabel(i) === dose && allowed.has(i)) out.push(i);
  }
  return out;
}

function doseForPatientId(patientId: number): string | undefined {
  const ds = requireDataset();
  for (let i = 0; i < ds.rowCount; i++) {
    if (ds.patientId(i) === patientId) return ds.doseLabel(i);
  }
  return undefined;
}

/** Placebo is excluded from box/violin *shapes* in the exposure distribution panel: by design
 * every placebo patient has zero exposure, so a box/violin of a constant isn't informative (it
 * would just be a degenerate spike). Its row still renders (label + N), it just skips the shape
 * - see the `skipShape` flag passed into `DistributionRawGroup` below. Placebo also appears
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
  /** Show each active reference-line split's own fitted value + CI, marked right on the curve
   * (e.g. "Fit 0.74 [0.70-0.78]"; for a continuous endpoint this is a fitted response, not a
   * probability). Independent of showSplitValue below - the two used to be bundled into one
   * marker. Off by default - opt-in, both because it's another marker competing for the same
   * space as showObservedResponders, and because its grey styling is easy to mix up with the
   * (near-black) observed markers if always on. */
  showReferenceFit: boolean;
  /** Show fitted value + CI at each observed split bin's center exposure (mean exposure in
   * bin among dosed patients; placebo bin stays at 0). Independent of showReferenceFit
   * (split-line fits). */
  showFittedAtObservedBin: boolean;
  /** Show each active reference-line split's own exposure value (e.g. "83.8") printed beneath the
   * line on the scatter panel - the same value the distribution panel below it always shows.
   * Independent of showReferenceFit. Off by default. */
  showSplitValue: boolean;
  /** Show each highlighted (clicked) dose's own observed %/N marker next to its projected curve
   * segment. On by default since it's the natural companion to clicking a dose row, but some
   * users will want the plain projection without it. */
  showDoseObserved: boolean;
  /** Optional alternate view: only meaningful with 2+ endpoints selected (all sharing the same
   * binary/continuous kind). Replaces the usual dose-colored endpoint-row grid with a single
   * "(all)" panel per exposure metric, overlaying every selected endpoint's curve together
   * (colored/dashed by endpoint instead of dose) - mirrors ggquickeda's endpoint-comparison facet
   * layout, generalized to any number of exposure metrics. */
  compareEndpoints: boolean;
  /** Show the raw jittered per-patient scatter points on the exposure-vs-response panel(s).
   * Applies to both the regular grid and Compare Endpoints (where points are colored by
   * endpoint instead of dose). On by default in the regular grid; Compare Endpoints has
   * historically kept them off since with several curves already overlaid, raw points add a lot
   * of visual noise - but the toggle now applies uniformly to both views. */
  showPoints: boolean;
  /** Facet grid: endpoints along rows (default) or exposures along rows. */
  gridLayout: GridLayout;
  doseColorScheme: ColorSchemeId;
  endpointColorScheme: ColorSchemeId;
  endpointModels: Record<string, EndpointAnalysisModel>;
  endpointNormScales: Record<string, EndpointNormScale>;
  dataFilters: DataFilterRule[];
  compareDistByEndpoint: boolean;
  scatterPaneRatio: number;
  metricStackHeightPx: number;
  showDistReadout: boolean;
  distReadoutExpanded: boolean;
  /** Display order for exposure columns in the plot grid (subset of dataset exposures). */
  exposureColumnOrder: MetricId[];
  /** Display order for endpoint rows/columns in the plot grid. */
  endpointColumnOrder: EndpointId[];
  /** Dose labels treated as reference arm (placebo/SOC). Empty = auto-detect from dataset. */
  referenceArmDoses: string[];
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
  showFittedAtObservedBin: false,
  showSplitValue: false,
  showDoseObserved: true,
  compareEndpoints: false,
  showPoints: true,
  gridLayout: "endpoint-rows",
  doseColorScheme: "default",
  endpointColorScheme: "default",
  endpointModels: {},
  endpointNormScales: {},
  dataFilters: [],
  compareDistByEndpoint: true,
  scatterPaneRatio: loadScatterPaneRatio(),
  metricStackHeightPx: loadMetricStackHeight(),
  showDistReadout: true,
  distReadoutExpanded: false,
  exposureColumnOrder: [],
  endpointColumnOrder: [],
  referenceArmDoses: []
};

function resolveDoseColor(dose: string): string {
  const ds = requireDataset();
  if (state.doseColorScheme === "default") return ds.doseColor(dose);
  return paletteColor(state.doseColorScheme, DOSE_ORDER(), dose);
}

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
const legendEl = $<HTMLDivElement>("legend");
const statusEl = $<HTMLDivElement>("status");
const exposureGroupEl = $<HTMLDivElement>("exposureGroup");
const distModeGroupEl = $<HTMLDivElement>("distModeGroup");
const refLineGroupEl = $<HTMLDivElement>("refLineGroup");
const refLineNoteEl = $<HTMLDivElement>("refLineNote");
const splitAnnotationModeEl = $<HTMLSelectElement>("splitAnnotationMode");
const showObservedRespEl = $<HTMLInputElement>("showObservedResp");
const showReferenceFitEl = $<HTMLInputElement>("showReferenceFit");
const showFittedAtObservedBinEl = $<HTMLInputElement>("showFittedAtObservedBin");
const showSplitValueEl = $<HTMLInputElement>("showSplitValue");
const showDoseObservedEl = $<HTMLInputElement>("showDoseObserved");
const showDistReadoutEl = $<HTMLInputElement>("showDistReadout");
const expandDistReadoutEl = $<HTMLInputElement>("expandDistReadout");
const showPointsEl = $<HTMLInputElement>("showPoints");
const endpointGroupEl = $<HTMLDivElement>("endpointGroup");
const compareEndpointsEl = $<HTMLInputElement>("compareEndpoints");
const compareDistByEndpointEl = $<HTMLInputElement>("compareDistByEndpoint");
const plotStackHeightHandleEl = $<HTMLDivElement>("plotStackHeightHandle");
const metricStackHeightRangeEl = $<HTMLInputElement>("metricStackHeightRange");
const metricStackHeightLabelEl = $<HTMLSpanElement>("metricStackHeightLabel");
const filterRulesListEl = $<HTMLDivElement>("filterRulesList");
const addFilterRuleBtn = $<HTMLButtonElement>("addFilterRuleBtn");
const filterStatusEl = $<HTMLSpanElement>("filterStatus");
const endpointLegendEl = $<HTMLDivElement>("endpointLegend");
const ciSelect = $<HTMLSelectElement>("ciSelect");
const resetBtn = $<HTMLButtonElement>("resetBtn");
const saveSessionBtn = $<HTMLButtonElement>("saveSessionBtn");
const loadSessionBtn = $<HTMLButtonElement>("loadSessionBtn");
const fileInput = $<HTMLInputElement>("fileInput");
const sessionStatus = $<HTMLSpanElement>("sessionStatus");
const kpiN = $<HTMLDivElement>("kpiN");
const kpiRespondersBody = $<HTMLDivElement>("kpiRespondersBody");
const kpiShowing = $<HTMLDivElement>("kpiShowing");
const kpiDoses = $<HTMLDivElement>("kpiDoses");
const csvFileInput = $<HTMLInputElement>("csvFileInput");
const mappingPanelEl = $<HTMLDivElement>("mappingPanel");
const mappingTableBody = $<HTMLTableSectionElement>("mappingTableBody");
const mappingErrorsEl = $<HTMLDivElement>("mappingErrors");
const applyMappingBtn = $<HTMLButtonElement>("applyMappingBtn");
const reloadBundledBtn = $<HTMLButtonElement>("reloadBundledBtn");
const editMappingBtn = $<HTMLButtonElement>("editMappingBtn");
const loadCsvBtn = $<HTMLButtonElement>("loadCsvBtn");
const dataStatusEl = $<HTMLSpanElement>("dataStatus");
const columnRolesSummaryEl = $<HTMLDivElement>("columnRolesSummary");
const columnRolesListEl = $<HTMLUListElement>("columnRolesList");
const referenceArmDosesEl = $<HTMLInputElement>("referenceArmDoses");
const referenceArmFieldEl = $<HTMLDivElement>("referenceArmField");
const gridLayoutSelect = $<HTMLSelectElement>("gridLayoutSelect");
const doseColorSchemeSelect = $<HTMLSelectElement>("doseColorScheme");
const endpointColorSchemeSelect = $<HTMLSelectElement>("endpointColorScheme");
const endpointModelsListEl = $<HTMLDivElement>("endpointModelsList");
const compareNormSectionEl = $<HTMLDivElement>("compareNormSection");
const compareNormListEl = $<HTMLDivElement>("compareNormList");

let pendingCsvRows: Array<Record<string, import("@er-explorer/data").RawCellValue>> | null = null;
let pendingColumnRoles: Record<string, DemoColumnRole> = {};
interface PendingDatasetMeta {
  datasetId: string;
  datasetName: string;
  /** Turn on reference splits + observed markers for first-time example load. */
  applyExampleDefaults?: boolean;
}
let pendingDatasetMeta: PendingDatasetMeta | null = null;

function dataFilteredRowIndices(): number[] {
  if (!dataset) return [];
  const all = dataset.allRowIndices();
  if (!state.dataFilters.length) return all;
  const loaded = dataset.loaded;
  return all.filter((i) => state.dataFilters.every((r) => rowMatchesFilter(i, r, loaded)));
}

function exposureXMax(metric: ExposureMetric): number {
  return exposureXDomain(metric)[1];
}

function suggestFilterMode(col: { id: string; role: DemoColumnRole; numeric: boolean }): boolean {
  if (!dataset) return !col.numeric;
  if (col.role === "dose" || col.role === "endpoint") return true;
  if (!col.numeric) return true;
  return distinctColumnValues(dataset.loaded, col.id, 40).length <= 20;
}

function filterColumnOptions() {
  const ds = requireDataset();
  const labels: Record<string, string> = {};
  for (const id of ds.loaded.variableOrder) {
    const role = ds.columnRoles[id];
    if (role === "endpoint") labels[id] = ds.endpointLabel(id);
    else if (role === "exposure") labels[id] = ds.exposureLabel(id);
    else if (role === "dose") labels[id] = "Dose";
    else labels[id] = id;
  }
  return listFilterColumns(ds.loaded, ds.columnRoles, labels);
}

const exposureValue = (rowIndex: number, metric: ExposureMetric) => requireDataset().exposureValue(rowIndex, metric);
const endpointValue = (rowIndex: number, endpoint: Endpoint): number => requireDataset().endpointValue(rowIndex, endpoint);

function recordsWithEndpoint(endpoint: Endpoint): number[] {
  const allowed = new Set(dataFilteredRowIndices());
  return requireDataset().rowIndicesWithEndpoint(endpoint).filter((i) => allowed.has(i));
}

const exposureLabel = (metric: ExposureMetric) => requireDataset().exposureLabel(metric);

function selectedExposureMetrics(): ExposureMetric[] {
  return exposureOrder().filter((m) => state.exposureMetrics.has(m));
}

function selectedEndpoints(): Endpoint[] {
  return endpointOrder().filter((e) => state.endpoints.has(e));
}

/** Chart pixel width for one panel column; the SVG's viewBox keeps it responsive regardless. */
function panelWidth(): number {
  const metrics = selectedExposureMetrics();
  const endpoints = selectedEndpoints();
  const cols =
    state.gridLayout === "exposure-rows" ? Math.max(1, endpoints.length) : Math.max(1, metrics.length);
  return Math.max(480, Math.floor(1200 / cols));
}

/** A fitted model for one metric/endpoint pair, tagged by which family produced it - "logistic"
 * for the existing binary responder endpoints (ICGI/ICGI2/ICGI3), "linear" (the
 * @er-explorer/model-linear plugin) for the continuous rating-scale endpoints (BRLS/PRLS). Both
 * `LogisticModel` and `LinearParams` expose `intercept`/`slope`, so most call sites only need to
 * branch on `kind` where the two families' meaning actually diverges (the response scale, and
 * whether a fitted value needs a sigmoid transform). */
type EndpointFit = { kind: "logistic"; model: LogisticModel } | { kind: "linear"; model: LinearParams };

function fitFor(metric: ExposureMetric, endpoint: Endpoint): { fit: EndpointFit; xs: number[]; ys: number[] } {
  const indices = recordsWithEndpoint(endpoint);
  const xs = indices.map((i) => exposureValue(i, metric));
  const ys = indices.map((i) => endpointValue(i, endpoint));
  if (isContinuousEndpoint(endpoint)) {
    const outcome = linearAnalysisModel.fit({ exposures: xs, responses: ys });
    if (!outcome.optimization.converged) throw new Error(`Unable to fit linear model for ${metric}/${endpoint}`);
    return { fit: { kind: "linear", model: outcome.params }, xs, ys };
  }
  const model = fitLogisticModel(xs, ys);
  if (!model) throw new Error(`Unable to fit logistic model for ${metric}/${endpoint}`);
  return { fit: { kind: "logistic", model }, xs, ys };
}

function curveFor(fit: EndpointFit, xs: number[], ys: number[], xDomain: [number, number]): PredictionResult {
  const [xMin, xMax] = xDomain;
  const span = xMax - xMin || 1;
  const dense = Array.from({ length: 121 }, (_, i) => xMin + (span * i) / 120);
  if (fit.kind === "linear") {
    const surface = linearAnalysisModel.predict(fit.model);
    const points = surface.evaluate(dense);
    if (state.ciMethod === "none") {
      // Point estimate only - skip computing (and discarding) a CI entirely, not just hide it,
      // since Wald/bootstrap are otherwise always computed even when nothing ends up drawing them.
      return { estimates: dense.map((exposure, i) => ({ exposure, estimate: points[i].estimate, lower: NaN, upper: NaN })), metadata: {} };
    }
    const ci =
      state.ciMethod === "bootstrap"
        ? linearAnalysisModel.confidenceInterval(
            fit.model,
            { exposures: xs, responses: ys },
            { exposures: dense, method: "bootstrap", bootstrap: { resamples: state.bootstrapResamples, seed: state.bootstrapSeed, level: 0.95 } }
          )
        : linearAnalysisModel.confidenceInterval(fit.model, { exposures: xs, responses: ys }, { exposures: dense, method: "wald" });
    return {
      estimates: dense.map((exposure, i) => ({
        exposure,
        estimate: points[i].estimate,
        lower: ci[i]?.lower ?? NaN,
        upper: ci[i]?.upper ?? NaN
      })),
      metadata: {}
    };
  }
  if (state.ciMethod === "none") {
    // Wald is the cheap, closed-form point estimate for the logistic branch (no resampling) -
    // reused here purely for its `estimate` values, with lower/upper discarded, same as above.
    const wald = predictLogisticWaldResult(fit.model, dense);
    return { ...wald, estimates: wald.estimates.map((e) => ({ ...e, lower: NaN, upper: NaN })) };
  }
  if (state.ciMethod === "wald") return predictLogisticWaldResult(fit.model, dense);
  return bootstrapLogisticCI(xs, ys, dense, {
    resamples: state.bootstrapResamples,
    seed: state.bootstrapSeed
  });
}

/** Two-line fit callout: estimate, then optional bracketed CI (no "Fit" prefix — color encodes split vs bin). */
function formatFitMarkerLines(estimate: number, lower: number, upper: number, decimals: number): [string, string] {
  const line1 = estimate.toFixed(decimals);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return [line1, ""];
  return [line1, `[${lower.toFixed(decimals)}-${upper.toFixed(decimals)}]`];
}

function formatExposureForReadout(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1);
}

function scatterPointHoverLabel(rowIndex: number, metric: ExposureMetric, endpoint: Endpoint, endpointDisplay?: string): string {
  const ds = requireDataset();
  const epName = endpointDisplay ?? endpoint.toUpperCase();
  const epVal = endpointValue(rowIndex, endpoint);
  const epStr = Number.isFinite(epVal) && !Number.isInteger(epVal) ? epVal.toFixed(1) : String(epVal);
  return [
    `${exposureLabel(metric)} ${exposureValue(rowIndex, metric).toFixed(1)}`,
    `${epName} ${epStr}`,
    ds.doseLabel(rowIndex),
    ...ds.covariateHoverParts(rowIndex)
  ].join(" · ");
}

function scatterDatumFromPoint(p: ScatterPoint, style: Omit<ScatterPointDatum, "id" | "x" | "y" | "data" | "label">): ScatterPointDatum {
  const tip = p.label ?? "";
  return {
    id: p.id,
    x: p.exposure,
    y: p.displayY ?? p.response,
    label: tip,
    ...style,
    data: {
      "data-id": p.id,
      "data-exposure": p.exposure,
      "data-response": p.response,
      "data-group": String(p.groupId),
      ...(tip ? { "data-tip": tip } : {})
    }
  };
}

/** Plain-text tooltip for observed / dose-click markers (no fitted values — those have their own callouts). */
function observedMarkerTooltip(exposureAxisLabel: string, exposureX: number, headline: string, detail: string): string {
  return [`${exposureAxisLabel}: ${formatExposureForReadout(exposureX)}`, headline, detail].join("\n");
}

/** Exposure-only hover for split-line fit callouts (label already shows Fit + CI). */
function splitFitMarkerTooltip(exposureAxisLabel: string, exposureX: number): string {
  return `${exposureAxisLabel} at split: ${formatExposureForReadout(exposureX)}`;
}

function binFitMarkerTooltip(exposureAxisLabel: string, exposureX: number): string {
  return `${exposureAxisLabel} at bin (mean): ${formatExposureForReadout(exposureX)}`;
}

/** Pushes fit+CI markers at exposure x-positions (e.g. mean exposure per split bin). */
function createFitAtObservedBinLayer(
  layerId: string,
  exposureXs: number[],
  curveSamples: CurveSample[],
  exposureAxisLabel: string,
  fitDecimals: number,
  color = "#0f172a"
): RendererLayer {
  const uniq = [...new Set(exposureXs.filter((x) => Number.isFinite(x)).map((x) => Math.round(x * 1000) / 1000))];
  return {
    id: layerId,
    kind: "observed-stat",
    render(ctx) {
      uniq.forEach((exposureX, i) => {
        const at = interpolateCurveSample(curveSamples, exposureX);
        const [l1, l2] = formatFitMarkerLines(at.estimate, at.lower, at.upper, fitDecimals);
        ctx.markers.add({
          id: `${layerId}:${i}`,
          ownerLayerId: layerId,
          x: ctx.xScale(exposureX),
          y: ctx.yScale(at.estimate),
          ...(Number.isFinite(at.lower) && Number.isFinite(at.upper)
            ? { yLow: ctx.yScale(at.lower), yHigh: ctx.yScale(at.upper) }
            : {}),
          color,
          lines: [l1, l2],
          kind: "reference-fit-at-bin",
          tooltip: binFitMarkerTooltip(exposureAxisLabel, exposureX)
        });
      });
    }
  };
}

/** Adapts a legacy `PredictionResult`'s loosely-typed `estimates` into `@er-explorer/renderer`'s
 * `CurveSample[]` - a plain field-by-field copy (not a cast), since `PredictionResult.estimates`
 * is typed as `Array<Record<string, number>>` and isn't directly assignable to `CurveSample`'s
 * named fields. Used by both scatter chart cutovers (Phase 4 continuous, Phase 5 binary). */
function toCurveSamples(curve: PredictionResult): CurveSample[] {
  return curve.estimates.map((e) => ({ exposure: e.exposure, estimate: e.estimate, lower: e.lower, upper: e.upper }));
}

/** The continuous scatter chart's dynamic response-axis domain - ported verbatim from the
 * now-retired `renderLinearScatterChart`'s fallback (that function's own `yDomain` was never
 * actually supplied by this app, so this computation simply moves to the caller, which is now
 * responsible for supplying `RenderInput.yDomain` explicitly). */
function computeContinuousYDomain(points: Array<{ displayY?: number; response: number }>, curveSamples: CurveSample[]): [number, number] {
  const values: number[] = [...points.map((p) => p.displayY ?? p.response), ...curveSamples.flatMap((e) => [e.lower, e.upper]).filter((v) => isFinite(v))];
  if (!values.length) return [0, 1];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.08, 0.5);
  return [lo - pad, hi + pad];
}

/** Scatter charts' fixed SVG height, shared by `renderContinuousScatterViaRenderer` and
 * `renderBinaryScatterOverlay` below, and also applied as the chart `<div>`'s own inline height
 * in `renderScatterPanel` (see `SCATTER_CHART_HEIGHT` usage there). The SVG element itself is
 * emitted with `width="100%" height="100%"` and no `preserveAspectRatio="none"` override, so a
 * container whose own aspect ratio doesn't match this intrinsic width/height gets letterboxed by
 * the browser's default `xMidYMid meet` behavior - which silently rescales the chart's *effective*
 * horizontal content width relative to its container. The exposure-distribution strip below each
 * scatter row already pins its own container's height to its own intrinsic SVG height for exactly
 * this reason (see `appendDistributionMini`'s `style="height: ${height}px"`) - if this scatter
 * height and that div's inline height ever drift out of sync with each other, the two rows stop
 * sharing the same effective horizontal scale and their vertical reference lines (Min/Median/Max)
 * visibly stop lining up between the scatter chart and the distribution strip beneath it. */
const SCATTER_CHART_HEIGHT = 380;
const COMPARE_SCATTER_CHART_HEIGHT = 480;
const NEUTRAL_COMPARE_COLOR = "#64748b";
/** Dose selection accent in compare-endpoints mode (not dose palette). */
const DOSE_SELECTION_NEUTRAL = "#475569";

function compareDistUsesNeutralShapes(): boolean {
  return isEndpointComparisonActive() && !state.compareDistByEndpoint;
}

function attachStackSplitter(stack: HTMLElement): void {
  attachMetricStackSplitter(
    stack,
    (ratio) => {
      state.scatterPaneRatio = ratio;
      applyScatterPaneRatio(stack, ratio);
    },
    () => {
      saveScatterPaneRatio(state.scatterPaneRatio);
      paintSyncedMetricStacks(activeSet());
    }
  );
}

function refreshSelectionVisuals(): void {
  const active = activeSet();
  const endpoints = selectedEndpoints();
  schedulePaintSyncedMetricStacks(active);
  updateStatus(active.size);
  updateKpis(active.size, endpoints);
  requestAnimationFrame(() => schedulePaintSyncedMetricStacks(active));
}

function applyReadoutChrome(readoutEl?: HTMLElement | null): void {
  const apply = (el: HTMLElement) => {
    el.classList.toggle("readout-off", !state.showDistReadout);
    el.classList.toggle("readout-collapsed", state.showDistReadout && !state.distReadoutExpanded);
  };
  if (readoutEl) apply(readoutEl);
  else document.querySelectorAll<HTMLElement>(".readout").forEach(apply);
}

function distPaintContextForStack(
  stack: HTMLElement,
  endpointFallback: Endpoint
): {
  endpoint: Endpoint;
  splitByEndpoints?: Endpoint[];
  readoutEndpoints: Endpoint[];
  omitEndpointFit: boolean;
} {
  const compareRaw = stack.dataset.compareEndpoints;
  if (compareRaw) {
    const eps = compareRaw.split("|").filter(Boolean) as Endpoint[];
    if (eps.length > 1) {
      return {
        endpoint: eps[0]!,
        splitByEndpoints: state.compareDistByEndpoint ? eps : undefined,
        readoutEndpoints: state.compareDistByEndpoint ? eps : [eps[0]!],
        omitEndpointFit: !state.compareDistByEndpoint
      };
    }
  }
  const readoutEps = selectedEndpoints();
  return {
    endpoint: endpointFallback,
    splitByEndpoints: undefined,
    readoutEndpoints: readoutEps.length > 1 ? readoutEps : [endpointFallback],
    omitEndpointFit: false
  };
}

function applyAllMetricStackHeights(): void {
  document.querySelectorAll<HTMLElement>(".facet-layout").forEach((facet) => {
    applyMetricStackHeight(facet, state.metricStackHeightPx);
    applyScatterPaneRatio(facet, state.scatterPaneRatio);
  });
  document.querySelectorAll<HTMLElement>(".metric-stack").forEach((stack) => {
    if (stack.closest(".facet-layout")) return;
    applyMetricStackHeight(stack, state.metricStackHeightPx);
  });
}

function attachFacetLayoutSplitter(facet: HTMLElement): void {
  attachFacetBlockSplitter(
    facet,
    (ratio) => {
      state.scatterPaneRatio = ratio;
    },
    () => {
      saveScatterPaneRatio(state.scatterPaneRatio);
      paintSyncedMetricStacks(activeSet());
    }
  );
}

function createFacetLayoutShell(): HTMLElement {
  const facet = document.createElement("div");
  facet.className = "facet-layout";
  applyScatterPaneRatio(facet, state.scatterPaneRatio);
  applyMetricStackHeight(facet, state.metricStackHeightPx);

  const scatterBlock = document.createElement("div");
  scatterBlock.className = "facet-scatter-block";

  const splitter = document.createElement("div");
  splitter.className = "metric-stack-splitter facet-block-splitter";
  splitter.title = "Drag to resize scatter area vs exposure distributions";

  const distBlock = document.createElement("div");
  distBlock.className = "facet-dist-block";

  facet.appendChild(scatterBlock);
  facet.appendChild(splitter);
  facet.appendChild(distBlock);
  return facet;
}

function syncMetricStackHeightUi(): void {
  const auto = state.metricStackHeightPx <= 0;
  metricStackHeightRangeEl.disabled = auto;
  if (!auto) metricStackHeightRangeEl.value = String(state.metricStackHeightPx);
  metricStackHeightLabelEl.textContent = auto
    ? "Auto — charts fill the plot area. Double-click the bar below the charts to return to auto after fixing height."
    : `${state.metricStackHeightPx}px fixed · drag the bar below or use the slider`;
  plotStackHeightHandleEl.hidden = !dataset;
}

function setMetricStackHeight(px: number, persist = true): void {
  state.metricStackHeightPx = px <= 0 ? 0 : Math.max(320, Math.min(1200, Math.round(px)));
  applyAllMetricStackHeights();
  syncMetricStackHeightUi();
  if (persist) saveMetricStackHeight(state.metricStackHeightPx);
}

/** Keep SVG x-scale aligned with its container (same width for scatter + distribution in a stack). */
function pinChartSvgToContainer(container: HTMLElement, width: number, height: number): void {
  const svg = container.querySelector("svg");
  if (!svg) return;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
}

function measureStackCharts(stack: HTMLElement): { width: number; scatterH: number; distH: number } | null {
  const kind = stack.dataset.stackKind ?? "regular";
  const width = Math.max(240, Math.round(stack.getBoundingClientRect().width));

  if (kind === "dist-only") {
    const distWrap = stack.querySelector(".metric-stack-dist .chart") as HTMLDivElement | null;
    if (!distWrap) return null;
    const distH = Math.max(72, Math.round(distWrap.getBoundingClientRect().height));
    if (width < 32 || distH < 24) return null;
    return { width, scatterH: 0, distH };
  }

  const scatterWrap = stack.querySelector(".metric-stack-scatter .chart") as HTMLDivElement | null;
  if (!scatterWrap) return null;
  const scatterH = Math.max(80, Math.round(scatterWrap.getBoundingClientRect().height));

  if (kind === "scatter-only" || kind === "scatter-compare") {
    if (width < 32 || scatterH < 24) return null;
    return { width, scatterH, distH: 0 };
  }

  const distWrap = stack.querySelector(".metric-stack-dist .chart") as HTMLDivElement | null;
  const distH = distWrap ? Math.max(72, Math.round(distWrap.getBoundingClientRect().height)) : 140;
  if (width < 32 || scatterH < 24) return null;
  return { width, scatterH, distH };
}

let metricStackResizeObserver: ResizeObserver | undefined;

function resetMetricStackObservers(): void {
  metricStackResizeObserver?.disconnect();
}

function observeMetricStacks(): void {
  if (typeof ResizeObserver === "undefined") return;
  if (!metricStackResizeObserver) {
    metricStackResizeObserver = new ResizeObserver(() => {
      if (!dataset) return;
      schedulePaintSyncedMetricStacks(activeSet());
    });
  }
  document.querySelectorAll(".facet-layout, .metric-stack").forEach((el) => metricStackResizeObserver!.observe(el));
}

let paintSyncedStacksScheduled = false;

function schedulePaintSyncedMetricStacks(active: Set<number>): void {
  if (paintSyncedStacksScheduled) return;
  paintSyncedStacksScheduled = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      paintSyncedStacksScheduled = false;
      paintSyncedMetricStacks(active);
    });
  });
}

function paintSyncedMetricStacks(active: Set<number>): void {
  if (!dataset) return;
  distributionPanels = [];
  document.querySelectorAll<HTMLElement>(".metric-stack").forEach((stack) => {
    const kind = stack.dataset.stackKind ?? "regular";
    const metric = stack.dataset.metric as ExposureMetric;
    if (!metric) return;
    const scatterWrap = stack.querySelector(".metric-stack-scatter .chart") as HTMLDivElement | null;
    const distCell = stack.querySelector(".metric-stack-dist") as HTMLElement | null;
    const distWrap = stack.querySelector(".metric-stack-dist .chart") as HTMLDivElement | null;
    const layout = measureStackCharts(stack);
    if (!layout) return;
    const { width, scatterH, distH } = layout;

    if (kind === "scatter-only") {
      const endpoint = stack.dataset.endpoint as Endpoint;
      if (!endpoint || !scatterWrap) return;
      paintRegularScatterIntoWrap(scatterWrap, metric, endpoint, active, width, scatterH);
      pinChartSvgToContainer(scatterWrap, width, scatterH);
      return;
    }

    if (kind === "scatter-compare") {
      const endpoints = (stack.dataset.compareEndpoints ?? "")
        .split("|")
        .filter(Boolean) as Endpoint[];
      if (!endpoints.length || !scatterWrap) return;
      paintCompareScatterIntoWrap(scatterWrap, metric, endpoints, active, width, scatterH);
      pinChartSvgToContainer(scatterWrap, width, scatterH);
      return;
    }

    if (kind === "dist-only") {
      const endpoint = stack.dataset.endpoint as Endpoint;
      if (!endpoint || !distCell || !distWrap) return;
      const ctx = distPaintContextForStack(stack, endpoint);
      paintDistributionChart(
        distCell,
        distWrap,
        distCell.querySelector(".readout") as HTMLDivElement | null,
        metric,
        ctx.endpoint,
        active,
        width,
        distH,
        ctx.splitByEndpoints,
        ctx.readoutEndpoints,
        { showReadout: true, omitEndpointFit: ctx.omitEndpointFit }
      );
      return;
    }
  });
}

/**
 * Renders the continuous (BRLS/PRLS) exposure-response scatter chart via `@er-explorer/renderer`
 * - the first real cutover off `packages/visualization-engine` (Phase 4 of the renderer
 * redesign, docs/RENDERER_ARCHITECTURE.md §8). Reproduces `renderLinearScatterChart`'s visual
 * output using Grid/Axis/ConfidenceRibbon/Fit/ObservedStat/Annotation/Scatter layers plus
 * `DoseProjectionLayer` for the dose-click projection geometry.
 *
 * One intentional visual difference from the old output, already flagged and accepted during
 * Phase 1 (see the rank table's comment in `svgRenderer.ts`): the x-axis now paints right after
 * the grid (rank 5) instead of after the curve/points (the old code's implicit order) - so axis
 * ticks no longer risk being partly covered by a dense point cloud. Everything else keeps the
 * old paint order because it falls directly out of the fixed rank table plus this function's own
 * construction order (see docs/RENDERER_ARCHITECTURE.md §6).
 */
function renderContinuousScatterViaRenderer(
  points: ScatterPoint[],
  curve: PredictionResult,
  projected: LinearProjectedGroup[],
  xDomain: [number, number],
  metric: ExposureMetric,
  endpoint: Endpoint,
  width: number,
  referenceLines: ReferenceLine[],
  observedMeanBins: ObservedMeanBin[],
  height = SCATTER_CHART_HEIGHT
): { content: string; metadata: ScatterMeta } {
  const ds = requireDataset();
  const curveSamples = toCurveSamples(curve);
  const yDomain = computeContinuousYDomain(points, curveSamples);
  const plotHeight = height;

  const scatterPoints: ScatterPointDatum[] = (state.showPoints ? points : []).map((p) =>
    scatterDatumFromPoint(p, {
      color: resolveDoseColor(String(p.groupId)) ?? "#64748b",
      radius: p.selected ? 4.2 : 3.1,
      opacity: p.selected ? 0.84 : 0.14,
      stroke: p.selected ? "#ffffff" : undefined,
      strokeWidth: p.selected ? 1 : undefined
    })
  );

  const layers: RendererLayer[] = [
    new GridLayer({ id: "grid" }),
    new AxisLayer({ id: "axis-x", orientation: "x", label: exposureLabel(metric) }),
    new AxisLayer({
      id: "axis-y",
      orientation: "y",
      label: endpoint.toUpperCase(),
      format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
    }),
    new ConfidenceRibbonLayer({ id: "band", samples: curveSamples, color: "#94a3b8", opacity: 0.18 }),
    new FitLayer({ id: "curve", samples: curveSamples, color: "#64748b" })
  ];

  if (projected.length) {
    const rangeSamplesFor = (p: LinearProjectedGroup) => {
      const lo = p.min ?? p.whiskerLow;
      const hi = p.max ?? p.whiskerHigh;
      return curveSamples.filter((s) => s.exposure >= lo && s.exposure <= hi);
    };
    const coreSamplesFor = (p: LinearProjectedGroup) => curveSamples.filter((s) => s.exposure >= p.q1 && s.exposure <= p.q3);

    projected.forEach((p, i) => {
      layers.push(new ConfidenceRibbonLayer({ id: `proj-band-${i}`, samples: rangeSamplesFor(p), color: p.color, opacity: 0.1 }));
      layers.push(new FitLayer({ id: `proj-range-${i}`, samples: rangeSamplesFor(p), color: p.color, dash: null, strokeWidth: 1.8, opacity: 0.48 }));
      layers.push(new FitLayer({ id: `proj-core-${i}`, samples: coreSamplesFor(p), color: p.color, dash: null, strokeWidth: 3.8, opacity: 0.98 }));
    });

    layers.push(
      new DoseProjectionLayer({
        id: "projection-markers",
        curveSamples,
        groups: projected.map((p) => ({ color: p.color, q1: p.q1, q3: p.q3, median: p.median, min: p.min, max: p.max }))
      })
    );

    const observedMeanStats = projected
      .filter((p): p is LinearProjectedGroup & { observedMean: NonNullable<LinearProjectedGroup["observedMean"]> } => Boolean(p.observedMean))
      .map((p) => ({
        x: p.median,
        center: p.observedMean.mean,
        lower: p.observedMean.ciLower,
        upper: p.observedMean.ciUpper,
        n: p.observedMean.n,
        primaryLabel: p.observedMean.mean.toFixed(1),
        // Capital N - this is the clicked dose's own total observed count, not a quartile-bin
        // sub-count (see computeSplitAnnotations' "n=" for that).
        secondaryLabel: `N=${p.observedMean.n} · @ ${formatExposureForReadout(p.median)}`,
        color: p.color,
        tooltip: observedMarkerTooltip(
          exposureLabel(metric),
          p.median,
          `Observed mean ${p.observedMean.mean.toFixed(1)}`,
          `95% CI · N=${p.observedMean.n}`
        )
      }));
    if (observedMeanStats.length) layers.push(new ObservedStatLayer({ id: "projection-observed", bins: observedMeanStats }));
  }

  if (referenceLines.length) {
    const refSpecs: ReferenceLineSpec[] = referenceLines.map((ref) => {
      const spec: ReferenceLineSpec = { value: ref.value, label: ref.label };
      if (state.showSplitValue) spec.valueLabel = ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1);
      if (state.showReferenceFit) {
        const at = interpolateCurveSample(curveSamples, ref.value);
        const [l1, l2] = formatFitMarkerLines(at.estimate, at.lower, at.upper, 1);
        spec.markerValues = [
          {
            estimate: at.estimate,
            lower: at.lower,
            upper: at.upper,
            lines: [l1, l2],
            color: "#94a3b8",
            tooltip: splitFitMarkerTooltip(exposureLabel(metric), ref.value)
          }
        ];
      }
      return spec;
    });
    layers.push(new AnnotationLayer({ id: "reference-lines", lines: refSpecs }));
  }

  if (observedMeanBins.length) {
    layers.push(
      new ObservedStatLayer({
        id: "observed-mean-bins",
        bins: observedMeanBins.map((b) => ({
          x: b.x,
          center: b.mean,
          lower: b.ciLower,
          upper: b.ciUpper,
          n: b.n,
          primaryLabel: b.mean.toFixed(1),
          secondaryLabel: `n=${b.n} · @ ${formatExposureForReadout(b.x)}`,
          color: b.color,
          tooltip: observedMarkerTooltip(
            exposureLabel(metric),
            b.x,
            `Observed mean ${b.mean.toFixed(1)}`,
            `95% CI ${b.ciLower.toFixed(1)}–${b.ciUpper.toFixed(1)} · n=${b.n}`
          )
        }))
      })
    );
  }

  if (state.showFittedAtObservedBin && observedMeanBins.length) {
    layers.push(
      createFitAtObservedBinLayer(
        "fit-at-observed-bin",
        observedMeanBins.map((b) => b.x),
        curveSamples,
        exposureLabel(metric),
        1
      )
    );
  }

  layers.push(new ScatterLayer({ id: "points", points: scatterPoints, nativeTitle: false }));

  const result = new SVGRenderer().render({ width, height, xDomain, yDomain, layers });

  return {
    content: result.content as string,
    metadata: {
      plot: {
        left: result.metadata.plotRect.x,
        top: result.metadata.plotRect.y,
        width: result.metadata.plotRect.width,
        height: result.metadata.plotRect.height
      },
      xScale: { domain: [...result.metadata.xScale.domain], range: [...result.metadata.xScale.range] },
      yScale: { domain: [...result.metadata.yScale.domain], range: [...result.metadata.yScale.range] }
    }
  };
}

interface BinaryCurveOverlay {
  curve: PredictionResult;
  /** Raw-scale curve for marker labels when `curve` is compare-normalized. */
  rawCurve?: PredictionResult;
  fitLabelDecimals?: number;
  /** Defaults to the neutral grey/dashed styling (matches the old renderer's single-endpoint
   * default) when omitted - only "Compare endpoints" ever supplies this, one color per endpoint. */
  color?: string;
  dash?: string;
  projected?: ProjectedGroup[];
}

/**
 * Renders a binary (responder/non-responder) exposure-response scatter chart via
 * `@er-explorer/renderer` - the Phase 5 cutover off `packages/visualization-engine`'s
 * `renderLogisticScatterChart`. Reproduces that function's visual output using
 * Grid/Axis/ConfidenceRibbon/Fit/ObservedStat/Annotation/Scatter layers plus
 * `DoseProjectionLayer`, and generalizes to one or more overlaid curves via `curves` - a
 * single-element array reproduces the old plain single-endpoint chart, a multi-element array
 * reproduces the old `extraCurves`-based "Compare endpoints" overlay, with `curves[0]` as the
 * primary curve. Each curve gets its own dose-click projection when it supplies `projected`, so a
 * dose click highlights every overlaid endpoint's curve at once, not just the primary one.
 */
function renderBinaryScatterOverlay(
  points: ScatterPoint[],
  curves: BinaryCurveOverlay[],
  groupColors: Record<string, string>,
  xDomain: [number, number],
  xAxisLabel: string,
  yAxisLabel: string,
  width: number,
  referenceLines: ReferenceLine[],
  observedBins: ObservedResponseBin[],
  height = SCATTER_CHART_HEIGHT
): { content: string; metadata: ScatterMeta } {
  const plotHeight = height;
  const yDomain: [number, number] = [-0.18, 1.18];
  const hasExtras = curves.length > 1;
  const curveSamplesFor = curves.map((c) => toCurveSamples(c.curve));

  const scatterPoints: ScatterPointDatum[] = points.map((p) =>
    scatterDatumFromPoint(p, {
      color: groupColors[String(p.groupId)] ?? "#64748b",
      radius: p.selected ? 4.2 : 3.1,
      opacity: p.selected ? 0.84 : 0.14,
      stroke: p.selected ? "#ffffff" : undefined,
      strokeWidth: p.selected ? 1 : undefined
    })
  );

  const layers: RendererLayer[] = [
    new GridLayer({ id: "grid", yTickValues: [0, 1] }),
    new AxisLayer({ id: "axis-x", orientation: "x", label: xAxisLabel }),
    new AxisLayer({ id: "axis-y", orientation: "y", label: yAxisLabel, tickValues: [0, 1], format: (v) => String(v) })
  ];

  curves.forEach((c, i) => {
    const samples = curveSamplesFor[i];
    layers.push(new ConfidenceRibbonLayer({ id: `band-${i}`, samples, color: c.color, opacity: i === 0 ? 0.18 : 0.14 }));
    layers.push(new FitLayer({ id: `curve-${i}`, samples, color: c.color, dash: c.dash }));

    const projected = c.projected ?? [];
    if (!projected.length) return;

    const rangeSamplesFor = (p: ProjectedGroup) => {
      const lo = p.min ?? p.whiskerLow;
      const hi = p.max ?? p.whiskerHigh;
      return samples.filter((s) => s.exposure >= lo && s.exposure <= hi);
    };
    const coreSamplesFor = (p: ProjectedGroup) => samples.filter((s) => s.exposure >= p.q1 && s.exposure <= p.q3);

    projected.forEach((p, j) => {
      layers.push(new ConfidenceRibbonLayer({ id: `proj-band-${i}-${j}`, samples: rangeSamplesFor(p), color: p.color, opacity: 0.1 }));
      layers.push(new FitLayer({ id: `proj-range-${i}-${j}`, samples: rangeSamplesFor(p), color: p.color, dash: null, strokeWidth: 1.8, opacity: 0.48 }));
      layers.push(new FitLayer({ id: `proj-core-${i}-${j}`, samples: coreSamplesFor(p), color: p.color, dash: null, strokeWidth: 3.8, opacity: 0.98 }));
    });

    layers.push(
      new DoseProjectionLayer({
        id: `projection-markers-${i}`,
        curveSamples: samples,
        groups: projected.map((p) => ({ color: p.color, q1: p.q1, q3: p.q3, median: p.median, min: p.min, max: p.max }))
      })
    );

    const observedStats = projected
      .filter((p): p is ProjectedGroup & { observed: NonNullable<ProjectedGroup["observed"]> } => Boolean(p.observed))
      .map((p) => {
        const pct = Math.round(p.observed.proportion * 100);
        return {
          x: p.median,
          center: p.observed.proportion,
          lower: p.observed.ciLower,
          upper: p.observed.ciUpper,
          n: p.observed.n,
          primaryLabel: `${pct}%`,
          secondaryLabel: `${p.observed.responders}/${p.observed.n} · @ ${formatExposureForReadout(p.median)}`,
          color: p.color,
          tooltip: observedMarkerTooltip(
            xAxisLabel,
            p.median,
            `${pct}% observed (${p.observed.responders}/${p.observed.n})`,
            `Wilson 95% CI ${(p.observed.ciLower * 100).toFixed(0)}–${(p.observed.ciUpper * 100).toFixed(0)}%`
          )
        };
      });
    if (observedStats.length) layers.push(new ObservedStatLayer({ id: `projection-observed-${i}`, bins: observedStats }));

    const observedMeanStats = projected
      .filter((p): p is ProjectedGroup & { observedMean: NonNullable<ProjectedGroup["observedMean"]> } => Boolean(p.observedMean))
      .map((p) => ({
        x: p.median,
        center: p.observedMean.mean,
        lower: p.observedMean.ciLower,
        upper: p.observedMean.ciUpper,
        n: p.observedMean.n,
        primaryLabel: p.observedMean.primaryLabel ?? p.observedMean.mean.toFixed(1),
        secondaryLabel: p.observedMean.secondaryLabel ?? `N=${p.observedMean.n}`,
        color: p.color
      }));
    if (observedMeanStats.length) {
      layers.push(new ObservedStatLayer({ id: `projection-observed-mean-${i}`, bins: observedMeanStats }));
    }
  });

  if (referenceLines.length) {
    const refSpecs: ReferenceLineSpec[] = referenceLines.map((ref) => {
      const spec: ReferenceLineSpec = { value: ref.value, label: ref.label };
      if (state.showSplitValue) spec.valueLabel = ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1);
      if (state.showReferenceFit) {
        spec.markerValues = curves.map((c, ci) => {
          const at = interpolateCurveSample(curveSamplesFor[ci], ref.value);
          const rawSamples = c.rawCurve ? toCurveSamples(c.rawCurve) : curveSamplesFor[ci];
          const rawAt = c.rawCurve ? interpolateCurveSample(rawSamples, ref.value) : at;
          const dec = c.fitLabelDecimals ?? 2;
          const color = ci === 0 ? (hasExtras ? c.color ?? "#94a3b8" : "#94a3b8") : c.color ?? "#94a3b8";
          const [l1, l2] = formatFitMarkerLines(rawAt.estimate, rawAt.lower, rawAt.upper, dec);
          return {
            estimate: at.estimate,
            lower: at.lower,
            upper: at.upper,
            lines: [l1, l2] as [string, string],
            color,
            tooltip: splitFitMarkerTooltip(xAxisLabel, ref.value)
          };
        });
      }
      return spec;
    });
    layers.push(new AnnotationLayer({ id: "reference-lines", lines: refSpecs }));
  }

  if (observedBins.length) {
    layers.push(
      new ObservedStatLayer({
        id: "observed-response-bins",
        bins: observedBins.map((b) => {
          const pct = Math.round(b.proportion * 100);
          const primary = b.primaryLabel ?? `${pct}%`;
          const secondary = b.secondaryLabel ?? `${b.responders}/${b.n} · @ ${formatExposureForReadout(b.x)}`;
          return {
            x: b.x,
            center: b.proportion,
            lower: b.ciLower,
            upper: b.ciUpper,
            n: b.n,
            primaryLabel: primary,
            secondaryLabel: secondary,
            color: b.color,
            strokeDash: b.strokeDash,
            tooltip: observedMarkerTooltip(
              xAxisLabel,
              b.x,
              `${pct}% observed (${b.responders}/${b.n})`,
              `Wilson 95% CI ${(b.ciLower * 100).toFixed(0)}–${(b.ciUpper * 100).toFixed(0)}% · mean ${xAxisLabel} in bin`
            )
          };
        })
      })
    );
  }

  if (state.showFittedAtObservedBin && observedBins.length) {
    curves.forEach((c, ci) => {
      const dec = c.fitLabelDecimals ?? 2;
      const color = hasExtras ? c.color ?? "#0f172a" : "#0f172a";
      layers.push(
        createFitAtObservedBinLayer(
          `fit-at-observed-bin-${ci}`,
          observedBins.map((b) => b.x),
          curveSamplesFor[ci]!,
          xAxisLabel,
          dec,
          color
        )
      );
    });
  }

  layers.push(new ScatterLayer({ id: "points", points: scatterPoints, nativeTitle: false }));

  const result = new SVGRenderer().render({ width, height, xDomain, yDomain, layers });

  return {
    content: result.content as string,
    metadata: {
      plot: {
        left: result.metadata.plotRect.x,
        top: result.metadata.plotRect.y,
        width: result.metadata.plotRect.width,
        height: result.metadata.plotRect.height
      },
      xScale: { domain: [...result.metadata.xScale.domain], range: [...result.metadata.xScale.range] },
      yScale: { domain: [...result.metadata.yScale.domain], range: [...result.metadata.yScale.range] }
    }
  };
}

/**
 * Reference lines (median/tertiles/quartiles) for the given exposure metric, computed on all
 * dosed patients *excluding placebo* - placebo is fixed at zero exposure by design, so including
 * it would pull every cut point down and misrepresent where the treated population actually
 * falls. These are global cut points (not per-dose), so a dose group's box/violin position can
 * be read directly against them: is this group mostly above the global median, above Q3, etc.
 */
function computeReferenceLines(metric: ExposureMetric): ReferenceLine[] {
  const ds = requireDataset();
  const kind = state.referenceLineKind;
  if (!kind) return [];
  const allowed = new Set(dataFilteredRowIndices());
  const pkLike = exposureIsPkMetric(metric);
  const values = ds
    .allRowIndices()
    .filter((i) => allowed.has(i))
    .filter((i) => !pkLike || !isPlaceboDose(ds.doseLabel(i)))
    .map((i) => exposureValue(i, metric))
    .filter((v) => Number.isFinite(v))
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
 * The lines actually drawn on a chart: `computeReferenceLines`'s split cut points, plus a Min and
 * Max line at the same (non-placebo) population's exposure extremes - mirroring the author's
 * original R function's output. Deliberately kept separate from `computeReferenceLines` itself,
 * since that function's cut points also double as the *bin boundaries* for
 * `computeSplitAnnotations`/`computeObservedResponseBins`/`computeObservedMeanBins` - Min/Max
 * would be meaningless (and would silently double-count bins) there, but are exactly what a
 * caller building a chart's `referenceLines` prop wants.
 */
function computeDisplayReferenceLines(metric: ExposureMetric): ReferenceLine[] {
  const ds = requireDataset();
  const splits = computeReferenceLines(metric);
  if (!splits.length) return splits;
  const allowed = new Set(dataFilteredRowIndices());
  const pkLike = exposureIsPkMetric(metric);
  const values = ds
    .allRowIndices()
    .filter((i) => allowed.has(i))
    .filter((i) => !pkLike || !isPlaceboDose(ds.doseLabel(i)))
    .map((i) => exposureValue(i, metric))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!values.length) return splits;
  const min = Math.round(values[0] * 100) / 100;
  const max = Math.round(values[values.length - 1] * 100) / 100;

  const byValue = new Map<number, string[]>();
  const add = (value: number, label: string) => {
    const labels = byValue.get(value) ?? [];
    if (!labels.includes(label)) labels.push(label);
    byValue.set(value, labels);
  };
  add(min, "Min");
  for (const s of splits) add(s.value, s.label);
  add(max, "Max");
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
  const vals = rowIndicesForDose(dose).map((i) => exposureValue(i, metric));
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
    // Lowercase "n=" - this is a per-bin sub-count of this dose's own N (see the boxplot row's
    // own "N=" total label), not a second total, so it's deliberately labeled at the other end
    // of the N/n convention.
    const label = mode === "n_pct" ? `n=${counts[i]} (${pct}%)` : `n=${counts[i]}`;
    out.push({ x: (lower + upper) / 2, label });
  }
  return out;
}

function rowIndicesDosed(): number[] {
  return dataFilteredRowIndices().filter((i) => !isPlaceboDose(requireDataset().doseLabel(i)));
}

function rowIndicesPlacebo(): number[] {
  return dataFilteredRowIndices().filter((i) => isPlaceboDose(requireDataset().doseLabel(i)));
}

function computeObservedResponseBins(metric: ExposureMetric, endpoint: Endpoint): ObservedResponseBin[] {
  if (!state.showObservedResponders || !state.referenceLineKind) return [];
  const cutpoints = computeReferenceLines(metric).map((r) => r.value);
  if (!cutpoints.length) return [];

  const pkLike = exposureIsPkMetric(metric);
  const bins: ObservedResponseBin[] = [];
  const binCount = cutpoints.length + 1;
  const buckets: number[][] = Array.from({ length: binCount }, () => []);

  const pushBin = (rows: number[]) => {
    if (!rows.length) return;
    const responders = rows.filter((i) => endpointValue(i, endpoint) === 1).length;
    const ci = wilsonScoreInterval(responders, rows.length);
    const meanX = rows.reduce((sum, i) => sum + exposureValue(i, metric), 0) / rows.length;
    bins.push({ x: meanX, n: rows.length, responders, proportion: ci.proportion, ciLower: ci.lower, ciUpper: ci.upper });
  };

  if (pkLike) {
    const placeboRows = rowIndicesPlacebo();
    if (placeboRows.length) {
      const responders = placeboRows.filter((i) => endpointValue(i, endpoint) === 1).length;
      const ci = wilsonScoreInterval(responders, placeboRows.length);
      bins.push({ x: 0, n: placeboRows.length, responders, proportion: ci.proportion, ciLower: ci.lower, ciUpper: ci.upper });
    }
    rowIndicesDosed().forEach((i) => {
      const v = exposureValue(i, metric);
      let bin = 0;
      while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
      buckets[bin].push(i);
    });
    buckets.forEach(pushBin);
    return bins;
  }

  recordsWithEndpoint(endpoint).forEach((i) => {
    const v = exposureValue(i, metric);
    if (!Number.isFinite(v)) return;
    let bin = 0;
    while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
    buckets[bin].push(i);
  });
  buckets.forEach(pushBin);
  return bins;
}

/**
 * The continuous-endpoint counterpart of `computeObservedResponseBins`: instead of a responder
 * rate + Wilson CI per exposure-split bin, this reports the raw observed mean response + 95% CI
 * (`meanConfidenceInterval`) - there is no responder/non-responder concept for BRLS/PRLS.
 */
function computeObservedMeanBins(metric: ExposureMetric, endpoint: Endpoint): ObservedMeanBin[] {
  const ds = requireDataset();
  if (!state.showObservedResponders || !state.referenceLineKind) return [];
  const cutpoints = computeReferenceLines(metric).map((r) => r.value);
  if (!cutpoints.length) return [];

  const pkLike = exposureIsPkMetric(metric);
  const bins: ObservedMeanBin[] = [];
  const withEndpoint = recordsWithEndpoint(endpoint);
  const binCount = cutpoints.length + 1;
  const buckets: number[][] = Array.from({ length: binCount }, () => []);

  const pushBin = (rows: number[]) => {
    if (!rows.length) return;
    const mci = meanConfidenceInterval(rows.map((i) => endpointValue(i, endpoint)));
    const meanX = rows.reduce((sum, i) => sum + exposureValue(i, metric), 0) / rows.length;
    bins.push({ x: meanX, mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n });
  };

  if (pkLike) {
    const placeboRows = withEndpoint.filter((i) => isPlaceboDose(ds.doseLabel(i)));
    if (placeboRows.length) {
      const mci = meanConfidenceInterval(placeboRows.map((i) => endpointValue(i, endpoint)));
      bins.push({ x: 0, mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n });
    }
    withEndpoint
      .filter((i) => !isPlaceboDose(ds.doseLabel(i)))
      .forEach((i) => {
        const v = exposureValue(i, metric);
        let bin = 0;
        while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
        buckets[bin].push(i);
      });
    buckets.forEach(pushBin);
    return bins;
  }

  withEndpoint.forEach((i) => {
    const v = exposureValue(i, metric);
    if (!Number.isFinite(v)) return;
    let bin = 0;
    while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
    buckets[bin].push(i);
  });
  buckets.forEach(pushBin);
  return bins;
}

/** The active patient set is shared across every exposure panel: a brush made in one panel's
 * coordinate space still resolves to patient ids, which highlight the same patients everywhere. */
function activeSet(): Set<number> {
  const ds = requireDataset();
  let ids = new Set(dataFilteredRowIndices().map((i) => ds.patientId(i)));
  if (state.brushedIds) ids = new Set([...ids].filter((id) => state.brushedIds!.has(id)));
  if (state.selectedDoses.size) {
    ids = new Set([...ids].filter((id) => {
      const dose = doseForPatientId(id);
      return dose !== undefined && state.selectedDoses.has(dose);
    }));
  }
  return ids;
}

interface ScatterMeta {
  plot: { left: number; top: number; width: number; height: number };
  xScale: { domain: [number, number]; range: [number, number] };
  yScale: { domain: [number, number]; range: [number, number] };
}

function renderRegularFacetGrid(metrics: ExposureMetric[], endpoints: Endpoint[], _active: Set<number>): void {
  const ds = requireDataset();
  const compareOverlay = isEndpointComparisonActive();

  if (compareOverlay) {
    const facet = createFacetLayoutShell();
    const scatterBlock = facet.querySelector(".facet-scatter-block")!;
    const distBlock = facet.querySelector(".facet-dist-block")!;

    const rowEl = document.createElement("div");
    rowEl.className = "endpoint-row";
    rowEl.innerHTML = `<div class="facet-row-label">Response · endpoints overlaid</div>`;
    const rowGrid = document.createElement("div");
    rowGrid.className = "panel-grid";
    rowEl.appendChild(rowGrid);
    scatterBlock.appendChild(rowEl);
    for (const metric of metrics) {
      appendCompareScatterOnlyCell(rowGrid, metric, endpoints);
    }

    const distGrid = document.createElement("div");
    distGrid.className = "panel-grid facet-shared-dist-grid";
    for (const metric of metrics) {
      appendDistOnlyCell(distGrid, metric, endpoints[0]!, { compareEndpoints: endpoints });
    }
    distBlock.appendChild(distGrid);

    attachFacetLayoutSplitter(facet);
    scatterPanelsEl.appendChild(facet);
    return;
  }

  if (state.gridLayout === "exposure-rows") {
    for (const metric of metrics) {
      const facet = createFacetLayoutShell();
      const scatterBlock = facet.querySelector(".facet-scatter-block")!;
      const distBlock = facet.querySelector(".facet-dist-block")!;

      const rowEl = document.createElement("div");
      rowEl.className = "endpoint-row facet-metric-row";
      const rowGrid = document.createElement("div");
      rowGrid.className = "panel-grid";
      rowEl.innerHTML = `<div class="facet-row-label">${escapeHtml(exposureLabel(metric))}</div>`;
      rowEl.appendChild(rowGrid);
      for (const endpoint of endpoints) {
        appendScatterOnlyCell(rowGrid, metric, endpoint);
      }
      scatterBlock.appendChild(rowEl);

      const distGrid = document.createElement("div");
      distGrid.className = "panel-grid";
      for (const endpoint of endpoints) {
        appendDistOnlyCell(distGrid, metric, endpoint);
      }
      distBlock.appendChild(distGrid);

      attachFacetLayoutSplitter(facet);
      scatterPanelsEl.appendChild(facet);
    }
    return;
  }

  const facet = createFacetLayoutShell();
  const scatterBlock = facet.querySelector(".facet-scatter-block")!;
  const distBlock = facet.querySelector(".facet-dist-block")!;

  for (const endpoint of endpoints) {
    const rowEl = document.createElement("div");
    rowEl.className = "endpoint-row";
    rowEl.innerHTML = `<div class="facet-row-label">${escapeHtml(ds.endpointLabel(endpoint))}</div>`;
    const rowGrid = document.createElement("div");
    rowGrid.className = "panel-grid";
    rowEl.appendChild(rowGrid);
    scatterBlock.appendChild(rowEl);
    for (const metric of metrics) {
      appendScatterOnlyCell(rowGrid, metric, endpoint);
    }
  }

  const distGrid = document.createElement("div");
  distGrid.className = "panel-grid facet-shared-dist-grid";
  const readoutAnchor = endpoints[0]!;
  for (const metric of metrics) {
    appendDistOnlyCell(distGrid, metric, readoutAnchor);
  }
  distBlock.appendChild(distGrid);

  attachFacetLayoutSplitter(facet);
  scatterPanelsEl.appendChild(facet);
}

function appendScatterOnlyCell(grid: HTMLElement, metric: ExposureMetric, endpoint: Endpoint): void {
  const cell = document.createElement("div");
  cell.className = "panel-cell panel-cell-scatter";
  const stack = document.createElement("div");
  stack.className = "metric-stack metric-stack-scatter-only";
  stack.dataset.stackKind = "scatter-only";
  stack.dataset.metric = metric;
  stack.dataset.endpoint = endpoint;

  const scatterPane = document.createElement("div");
  scatterPane.className = "metric-stack-scatter";
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart";
  chartWrap.dataset.metric = metric;
  scatterPane.appendChild(chartWrap);
  stack.appendChild(scatterPane);
  cell.appendChild(stack);
  grid.appendChild(cell);
}

function appendCompareScatterOnlyCell(grid: HTMLElement, metric: ExposureMetric, endpoints: Endpoint[]): void {
  const cell = document.createElement("div");
  cell.className = "panel-cell panel-cell-scatter";
  const stack = document.createElement("div");
  stack.className = "metric-stack metric-stack-scatter-only";
  stack.dataset.stackKind = "scatter-compare";
  stack.dataset.metric = metric;
  stack.dataset.compareEndpoints = endpoints.join("|");

  const scatterPane = document.createElement("div");
  scatterPane.className = "metric-stack-scatter";
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart";
  chartWrap.dataset.metric = metric;
  scatterPane.appendChild(chartWrap);
  stack.appendChild(scatterPane);
  cell.appendChild(stack);
  grid.appendChild(cell);
}

function appendDistOnlyCell(
  grid: HTMLElement,
  metric: ExposureMetric,
  endpoint: Endpoint,
  opts?: { compareEndpoints?: Endpoint[] }
): void {
  const cell = document.createElement("div");
  cell.className = "panel-cell panel-cell-dist";
  const stack = document.createElement("div");
  stack.className = "metric-stack metric-stack-dist-only";
  stack.dataset.stackKind = "dist-only";
  stack.dataset.metric = metric;
  stack.dataset.endpoint = endpoint;
  if (opts?.compareEndpoints?.length) {
    stack.dataset.compareEndpoints = opts.compareEndpoints.join("|");
  }

  const distPane = document.createElement("div");
  distPane.className = "metric-stack-dist";
  stack.appendChild(distPane);
  cell.appendChild(stack);
  grid.appendChild(cell);
  ensureDistShell(distPane, { showReadout: true });
}

function render(): void {
  if (!dataset) {
    resetMetricStackObservers();
    scatterPanelsEl.innerHTML = "";
    legendEl.innerHTML = "";
    endpointLegendEl.innerHTML = "";
    kpiN.textContent = "—";
    kpiDoses.textContent = "—";
    kpiShowing.textContent = "—";
    kpiRespondersBody.innerHTML = "";
    statusEl.textContent = "";
    syncCompareNormUi([], false);
    return;
  }

  const metrics = selectedExposureMetrics();
  const endpoints = selectedEndpoints();
  const active = activeSet();

  resetMetricStackObservers();
  scatterPanelsEl.innerHTML = "";
  distributionPanels = [];

  // "Compare endpoints" overlays every selected endpoint's curve on the same response axis, so
  // it's only meaningful when they all share the same scale - either every selected endpoint is
  // a binary responder outcome (probability axis) or every one is a continuous rating scale
  // (though even then, two different continuous endpoints, e.g. BRLS and PRLS, generally sit on
  // different scales - this restriction just avoids ever mixing a [0,1] probability curve with a
  // rating-scale curve in the same panel). Any number of exposure metrics is fine - each gets its
  // own overlaid "(all)" column.
  const comparisonEligible = endpoints.length > 1;
  compareEndpointsEl.disabled = !comparisonEligible;

  const compareHasLinear =
    state.compareEndpoints && comparisonEligible && endpoints.some((e) => usesLinearModel(e));
  syncCompareNormUi(endpoints, compareHasLinear);

  if (state.compareEndpoints && comparisonEligible) {
    renderEndpointLegend(endpoints);
    endpointLegendEl.style.display = "flex";
    legendEl.style.display = "none";
    legendEl.innerHTML = "";
  } else {
    legendEl.style.display = "flex";
    endpointLegendEl.style.display = "none";
    renderLegend();
  }
  renderRegularFacetGrid(metrics, endpoints, active);
  updateStatus(active.size);
  updateKpis(active.size, endpoints);
  refLineNoteEl.style.display = state.referenceLineKind ? "block" : "none";
  // the two split annotations only mean anything once a reference-line split is chosen
  splitAnnotationModeEl.disabled = !state.referenceLineKind;
  showObservedRespEl.disabled = !state.referenceLineKind;
  showReferenceFitEl.disabled = !state.referenceLineKind;
  showFittedAtObservedBinEl.disabled = !state.referenceLineKind || !state.showObservedResponders;
  showSplitValueEl.disabled = !state.referenceLineKind;
  applyAllMetricStackHeights();
  syncMetricStackHeightUi();
  observeMetricStacks();
  schedulePaintSyncedMetricStacks(active);
  applyReadoutChrome();
}

interface BinaryDoseGroupStats {
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

/** Per-dose exposure quantiles (Q1/median/Q3/whiskers/min/max) + observed responder rate (95%
 * Wilson CI) for a binary endpoint, restricted to `active` patients - the data a dose row's
 * projection onto the fitted curve is built from. Shared by the regular per-endpoint grid
 * (`renderScatterPanel`) and the "Compare endpoints" overlay (`renderEndpointComparisonRow`), so
 * clicking a dose row projects consistently in both views. */
function computeBinaryDoseGroupStats(metric: ExposureMetric, endpoint: Endpoint, active: Set<number>): Record<string, BinaryDoseGroupStats> {
  const ds = requireDataset();
  const groupStats: Record<string, BinaryDoseGroupStats> = {};
  for (const dose of DOSE_ORDER()) {
    const doseRecords = rowIndicesForDose(dose).filter((i) => active.has(ds.patientId(i)));
    const vals = doseRecords.map((i) => exposureValue(i, metric)).sort((a, b) => a - b);
    if (!vals.length) continue;
    const s = summarizeDistribution(vals);
    if (!s) continue;
    const responders = doseRecords.filter((i) => endpointValue(i, endpoint) === 1).length;
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
  return groupStats;
}

type ContinuousDoseGroupStats = Omit<ProjectedGroup, "groupId" | "color">;

/** Exposure quantiles + observed mean/CI for a continuous endpoint, per dose (active patients). */
function computeContinuousDoseGroupStats(metric: ExposureMetric, endpoint: Endpoint, active: Set<number>): Record<string, ContinuousDoseGroupStats> {
  const ds = requireDataset();
  const groupStats: Record<string, ContinuousDoseGroupStats> = {};
  for (const dose of DOSE_ORDER()) {
    const doseRecords = recordsWithEndpoint(endpoint).filter((i) => active.has(ds.patientId(i)) && ds.doseLabel(i) === dose);
    const vals = doseRecords.map((i) => exposureValue(i, metric)).sort((a, b) => a - b);
    if (!vals.length) continue;
    const s = summarizeDistribution(vals);
    if (!s) continue;
    const mci = meanConfidenceInterval(doseRecords.map((i) => endpointValue(i, endpoint)));
    groupStats[dose] = {
      q1: s.q1,
      q3: s.q3,
      median: s.median,
      whiskerLow: s.whiskerLow,
      whiskerHigh: s.whiskerHigh,
      min: s.min,
      max: s.max,
      observedMean: { mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n }
    };
  }
  return groupStats;
}

function projectedLinearGroupsFor(
  groupStats: Record<string, ContinuousDoseGroupStats>,
  colorOverride?: string,
  compareNormalizeEndpoint?: Endpoint
): ProjectedGroup[] {
  return [...state.selectedDoses]
    .filter((dose) => groupStats[dose])
    .map((dose) => {
      const { observedMean: rawObservedMean, ...rest } = groupStats[dose]!;
      let observedMean = rawObservedMean;
      if (state.showDoseObserved && rawObservedMean && compareNormalizeEndpoint) {
        const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
        observedMean = {
          mean: normCompareValue(rawObservedMean.mean, compareNormalizeEndpoint),
          ciLower: normCompareValue(rawObservedMean.ciLower, compareNormalizeEndpoint),
          ciUpper: normCompareValue(rawObservedMean.ciUpper, compareNormalizeEndpoint),
          n: rawObservedMean.n,
          primaryLabel: fmt(rawObservedMean.mean),
          secondaryLabel: `[${fmt(rawObservedMean.ciLower)}–${fmt(rawObservedMean.ciUpper)}] N=${rawObservedMean.n}`
        };
      }
      return {
        groupId: dose,
        color: colorOverride ?? resolveDoseColor(dose),
        ...rest,
        observedMean: state.showDoseObserved ? observedMean : undefined
      };
    });
}

/** The clicked-dose projection for a binary endpoint's chart, built from `computeBinaryDoseGroupStats` -
 * shared by both `renderScatterPanel` and `renderEndpointComparisonRow`. Each projected group is
 * colored by dose by default (the regular per-endpoint grid, where dose is the meaningful
 * distinction on that single curve); `colorOverride` lets "Compare endpoints" mode color every
 * dose's projection by the endpoint's own color instead, so the projection reads as "this curve's
 * highlight" rather than blending into the dose-colored points/legend of a different endpoint. */
function projectedGroupsFor(groupStats: Record<string, BinaryDoseGroupStats>, colorOverride?: string): ProjectedGroup[] {
  const ds = requireDataset();
  return [...state.selectedDoses]
    .filter((dose) => groupStats[dose])
    .map((dose) => {
      const { observed, ...rest } = groupStats[dose]!;
      return {
        groupId: dose,
        color: colorOverride ?? resolveDoseColor(dose),
        ...rest,
        observed: state.showDoseObserved ? observed : undefined
      };
    });
}

function renderScatterPanel(
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  container: HTMLElement,
  opts?: { embedded?: boolean; chartHeight?: number }
): void {
  const ds = requireDataset();
  const { fit, xs, ys } = fitFor(metric, endpoint);
  const xDomain = exposureXDomain(metric);
  const curve = curveFor(fit, xs, ys, xDomain);
  const continuous = isContinuousEndpoint(endpoint);

  const points: ScatterPoint[] = recordsWithEndpoint(endpoint).map((i) => {
    const pid = ds.patientId(i);
    return {
      id: pid,
      exposure: exposureValue(i, metric),
      response: endpointValue(i, endpoint),
      displayY: continuous ? endpointValue(i, endpoint) : endpointValue(i, endpoint) + seededJitter(pid),
      groupId: ds.doseLabel(i),
      label: scatterPointHoverLabel(i, metric, endpoint),
      selected: active.has(pid)
    };
  });

  const width = panelWidth();
  let scatterResult: { content: string; metadata: unknown };

  if (continuous) {
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
        observedMean: { mean: number; ciLower: number; ciUpper: number; n: number };
      }
    > = {};
    for (const dose of DOSE_ORDER()) {
      const doseRecords = recordsWithEndpoint(endpoint).filter((i) => active.has(ds.patientId(i)) && ds.doseLabel(i) === dose);
      const vals = doseRecords.map((i) => exposureValue(i, metric)).sort((a, b) => a - b);
      if (!vals.length) continue;
      const s = summarizeDistribution(vals);
      if (!s) continue;
      const mci = meanConfidenceInterval(doseRecords.map((i) => endpointValue(i, endpoint)));
      groupStats[dose] = {
        q1: s.q1,
        q3: s.q3,
        median: s.median,
        whiskerLow: s.whiskerLow,
        whiskerHigh: s.whiskerHigh,
        min: s.min,
        max: s.max,
        n: vals.length,
        observedMean: { mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n }
      };
    }

    const projected: LinearProjectedGroup[] = [...state.selectedDoses]
      .filter((dose) => groupStats[dose])
      .map((dose) => {
        const { observedMean, ...rest } = groupStats[dose]!;
        return {
          groupId: dose,
          color: resolveDoseColor(dose),
          ...rest,
          observedMean: state.showDoseObserved ? observedMean : undefined
        };
      });

    scatterResult = renderContinuousScatterViaRenderer(
      points,
      curve,
      projected,
      xDomain,
      metric,
      endpoint,
      width,
      computeDisplayReferenceLines(metric),
      computeObservedMeanBins(metric, endpoint)
    );
  } else {
    const groupStats = computeBinaryDoseGroupStats(metric, endpoint, active);
    const projected = projectedGroupsFor(groupStats);

    scatterResult = renderBinaryScatterOverlay(
      state.showPoints ? points : [],
      [{ curve, projected }],
      DOSE_COLORS(),
      xDomain,
      exposureLabel(metric),
      endpoint.toUpperCase(),
      width,
      computeDisplayReferenceLines(metric),
      computeObservedResponseBins(metric, endpoint)
    );
  }

  const chartH = opts?.chartHeight ?? SCATTER_CHART_HEIGHT;
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart";
  chartWrap.dataset.metric = metric;
  chartWrap.style.height = opts?.embedded ? "100%" : `${chartH}px`;
  if (opts?.embedded) chartWrap.style.minHeight = "120px";

  if (opts?.embedded) {
    container.appendChild(chartWrap);
  } else {
    const cell = document.createElement("div");
    cell.className = "panel-cell";
    cell.appendChild(chartWrap);
    container.appendChild(cell);
  }

  chartWrap.innerHTML = scatterResult.content;
  const tip = document.createElement("div");
  tip.className = "tooltip";
  chartWrap.appendChild(tip);
  attachScatterInteractivity(chartWrap, tip, metric, endpoint, scatterResult.metadata as unknown as ScatterMeta);
}

function paintRegularScatterIntoWrap(
  chartWrap: HTMLDivElement,
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  width: number,
  height: number
): void {
  const ds = requireDataset();
  const { fit, xs, ys } = fitFor(metric, endpoint);
  const xDomain = exposureXDomain(metric);
  const curve = curveFor(fit, xs, ys, xDomain);
  const continuous = isContinuousEndpoint(endpoint);

  const points: ScatterPoint[] = recordsWithEndpoint(endpoint).map((i) => {
    const pid = ds.patientId(i);
    return {
      id: pid,
      exposure: exposureValue(i, metric),
      response: endpointValue(i, endpoint),
      displayY: continuous ? endpointValue(i, endpoint) : endpointValue(i, endpoint) + seededJitter(pid),
      groupId: ds.doseLabel(i),
      label: scatterPointHoverLabel(i, metric, endpoint),
      selected: active.has(pid)
    };
  });

  let scatterResult: { content: string; metadata: unknown };

  if (continuous) {
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
        observedMean: { mean: number; ciLower: number; ciUpper: number; n: number };
      }
    > = {};
    for (const dose of DOSE_ORDER()) {
      const doseRecords = recordsWithEndpoint(endpoint).filter((i) => active.has(ds.patientId(i)) && ds.doseLabel(i) === dose);
      const vals = doseRecords.map((i) => exposureValue(i, metric)).sort((a, b) => a - b);
      if (!vals.length) continue;
      const s = summarizeDistribution(vals);
      if (!s) continue;
      const mci = meanConfidenceInterval(doseRecords.map((i) => endpointValue(i, endpoint)));
      groupStats[dose] = {
        q1: s.q1,
        q3: s.q3,
        median: s.median,
        whiskerLow: s.whiskerLow,
        whiskerHigh: s.whiskerHigh,
        min: s.min,
        max: s.max,
        n: vals.length,
        observedMean: { mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n }
      };
    }

    const projected: LinearProjectedGroup[] = [...state.selectedDoses]
      .filter((dose) => groupStats[dose])
      .map((dose) => {
        const { observedMean, ...rest } = groupStats[dose]!;
        return {
          groupId: dose,
          color: resolveDoseColor(dose),
          ...rest,
          observedMean: state.showDoseObserved ? observedMean : undefined
        };
      });

    scatterResult = renderContinuousScatterViaRenderer(
      points,
      curve,
      projected,
      xDomain,
      metric,
      endpoint,
      width,
      computeDisplayReferenceLines(metric),
      computeObservedMeanBins(metric, endpoint),
      height
    );
  } else {
    const groupStats = computeBinaryDoseGroupStats(metric, endpoint, active);
    const projected = projectedGroupsFor(groupStats);

    scatterResult = renderBinaryScatterOverlay(
      state.showPoints ? points : [],
      [{ curve, projected }],
      DOSE_COLORS(),
      xDomain,
      exposureLabel(metric),
      endpoint.toUpperCase(),
      width,
      computeDisplayReferenceLines(metric),
      computeObservedResponseBins(metric, endpoint),
      height
    );
  }

  chartWrap.innerHTML = scatterResult.content;
  pinChartSvgToContainer(chartWrap, width, height);
  let tip = chartWrap.querySelector(".tooltip") as HTMLDivElement | null;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    chartWrap.appendChild(tip);
  }
  attachScatterInteractivity(chartWrap, tip, metric, endpoint, scatterResult.metadata as unknown as ScatterMeta);
}

function paintCompareScatterIntoWrap(
  chartWrap: HTMLDivElement,
  metric: ExposureMetric,
  endpoints: Endpoint[],
  active: Set<number>,
  width: number,
  height: number
): void {
  const ds = requireDataset();
  const xDomain = exposureXDomain(metric);
  const referenceLines = computeDisplayReferenceLines(metric);

  const pointsFor = (endpoint: Endpoint): ScatterPoint[] =>
    recordsWithEndpoint(endpoint).map((i) => {
      const pid = ds.patientId(i);
      const raw = endpointValue(i, endpoint);
      const linear = usesLinearModel(endpoint);
      const yDisplay = linear ? normCompareValue(raw, endpoint) + seededJitter(pid, 0.04) : raw + seededJitter(pid);
      return {
        id: pid,
        exposure: exposureValue(i, metric),
        response: raw,
        displayY: yDisplay,
        groupId: endpoint,
        label: scatterPointHoverLabel(i, metric, endpoint, ds.endpointLabel(endpoint)),
        selected: active.has(pid)
      };
    });

  const fits = endpoints.map((endpoint) => {
    const { fit, xs, ys } = fitFor(metric, endpoint);
    const rawCurve = curveFor(fit, xs, ys, xDomain);
    const linear = usesLinearModel(endpoint);
    const { min, max, valid } = getCompareNormBounds(endpoint);
    const curve = linear && valid ? mapCurveToCompareScale(rawCurve, min, max) : rawCurve;
    const observedBins = computeCompareObservedBins(metric, endpoint);
    let projected: ProjectedGroup[] = [];
    if (linear) {
      const linearStats = computeContinuousDoseGroupStats(metric, endpoint, active);
      projected = projectedLinearGroupsFor(linearStats, DOSE_SELECTION_NEUTRAL, endpoint);
    } else {
      const groupStats = computeBinaryDoseGroupStats(metric, endpoint, active);
      projected = projectedGroupsFor(groupStats, DOSE_SELECTION_NEUTRAL);
    }
    return {
      endpoint,
      curve,
      rawCurve: linear ? rawCurve : undefined,
      fitLabelDecimals: linear ? 1 : 2,
      observedBins,
      projected
    };
  });

  const neutralCurves = compareDistUsesNeutralShapes();
  const curves: BinaryCurveOverlay[] = fits.map((f) => ({
    curve: f.curve,
    rawCurve: f.rawCurve,
    fitLabelDecimals: f.fitLabelDecimals,
    color: neutralCurves ? NEUTRAL_COMPARE_COLOR : endpointColor(f.endpoint),
    dash: endpointDash(f.endpoint),
    projected: f.projected
  }));
  const allObservedBins = fits.flatMap((f) => f.observedBins);
  const allPoints = state.showPoints ? fits.flatMap((f) => pointsFor(f.endpoint)) : [];
  const pointColors = Object.fromEntries(endpoints.map((ep) => [ep, endpointColor(ep)]));
  const yLabel = endpoints.some((e) => usesLinearModel(e)) ? "Response (compare 0–1)" : "Response";
  const result = renderBinaryScatterOverlay(
    allPoints,
    curves,
    pointColors,
    xDomain,
    exposureLabel(metric),
    yLabel,
    width,
    referenceLines,
    allObservedBins,
    height
  );
  chartWrap.innerHTML = result.content;
  pinChartSvgToContainer(chartWrap, width, height);
}

function ensureDistShell(
  cell: HTMLElement,
  opts?: { externalReadout?: HTMLDivElement; showReadout?: boolean }
): { chartWrap: HTMLDivElement; readoutEl: HTMLDivElement | null } {
  const existing = cell.querySelector(".dist-inline");
  if (existing) {
    return {
      chartWrap: existing.querySelector(".chart") as HTMLDivElement,
      readoutEl: (opts?.externalReadout ?? existing.querySelector(".readout")) as HTMLDivElement | null
    };
  }
  const showReadout = opts?.showReadout !== false && !opts?.externalReadout;
  const wrap = document.createElement("div");
  wrap.className = "dist-inline";
  if (showReadout) {
    wrap.innerHTML =
      '<div class="dist-inline-label">Exposure distribution by dose</div><div class="chart dist-inline-chart" style="min-height:72px;height:100%;"></div><div class="readout"><span class="muted">Click a row above to show projected fit values at Min, Q1, Median, Q3, and Max.</span></div>';
  } else {
    wrap.innerHTML =
      '<div class="dist-inline-label">Exposure distribution by dose</div><div class="chart dist-inline-chart" style="min-height:72px;height:100%;"></div>';
  }
  cell.appendChild(wrap);
  return {
    chartWrap: wrap.querySelector(".chart") as HTMLDivElement,
    readoutEl: (opts?.externalReadout ?? (showReadout ? (wrap.querySelector(".readout") as HTMLDivElement) : null)) as HTMLDivElement | null
  };
}

function buildDistributionGroups(
  metric: ExposureMetric,
  splitByEndpoints?: Endpoint[]
): DistributionRawGroup[] {
  const xDomain = exposureXDomain(metric);
  const pkLike = exposureIsPkMetric(metric);

  const selectionAccent = doseSelectionAccentForDistribution();

  if (splitByEndpoints && splitByEndpoints.length > 1) {
    return DOSE_ORDER()
      .slice()
      .reverse()
      .flatMap((dose) => {
        const isPlacebo = isPlaceboDose(dose);
        if (!splitByEndpoints.some((ep) => rowIndicesForDose(dose).some((i) => Number.isFinite(endpointValue(i, ep))))) {
          return [];
        }
        return splitByEndpoints.map((ep, i) => {
          const rows = rowIndicesForDose(dose).filter((r) => Number.isFinite(endpointValue(r, ep)));
          const values =
            isPlacebo && pkLike ? [] : rows.map((r) => exposureValue(r, metric)).filter((v) => Number.isFinite(v));
          return {
            groupId: dose,
            label: i === 0 ? dose : "",
            color: endpointColor(ep),
            values,
            n: rows.length,
            selected: state.selectedDoses.has(dose),
            selectionColor: selectionAccent,
            skipShape: isPlacebo && pkLike,
            splitAnnotations:
              (isPlacebo && pkLike) || state.splitAnnotationMode === "off"
                ? undefined
                : computeSplitAnnotations(metric, dose, xDomain, state.splitAnnotationMode)
          };
        });
      });
  }

  return DOSE_ORDER()
    .slice()
    .reverse()
    .map((dose) => {
      const isPlacebo = isPlaceboDose(dose);
      const rows = rowIndicesForDose(dose);
      const values =
        isPlacebo && pkLike ? [] : rows.map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
      return {
        groupId: dose,
        label: dose,
        color: compareDistUsesNeutralShapes() ? NEUTRAL_COMPARE_COLOR : resolveDoseColor(dose),
        values,
        n: rows.length,
        selected: state.selectedDoses.has(dose),
        selectionColor: selectionAccent,
        skipShape: isPlacebo && pkLike,
        splitAnnotations:
          (isPlacebo && pkLike) || state.splitAnnotationMode === "off"
            ? undefined
            : computeSplitAnnotations(metric, dose, xDomain, state.splitAnnotationMode)
      };
    })
    .filter((g) => g.n > 0);
}

function paintDistributionChart(
  distCell: HTMLElement,
  chartWrap: HTMLDivElement,
  readoutEl: HTMLDivElement | null,
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  width: number,
  height: number,
  splitByEndpoints?: Endpoint[],
  readoutEndpoints?: Endpoint[],
  opts?: { showReadout?: boolean; omitEndpointFit?: boolean }
): void {
  const xDomain = exposureXDomain(metric);
  const distGroups = buildDistributionGroups(metric, splitByEndpoints);
  const distResult = renderDistributionViaRenderer(
    distGroups,
    xDomain,
    state.distributionMode,
    computeDisplayReferenceLines(metric),
    exposureLabel(metric),
    width,
    height
  );
  chartWrap.innerHTML = distResult.content;
  pinChartSvgToContainer(chartWrap, width, height);
  if (!readoutEl) return;
  const finalReadoutEndpoints = readoutEndpoints ?? (splitByEndpoints && splitByEndpoints.length > 1 ? splitByEndpoints : [endpoint]);
  attachDistributionInteractivity(chartWrap, metric, finalReadoutEndpoints, active, readoutEl, distResult.metadata, {
    omitEndpointFit: opts?.omitEndpointFit ?? (isEndpointComparisonActive() && !state.compareDistByEndpoint)
  });
}

/** Appends a compact exposure-by-dose distribution strip (Boxplot, Distribution/half-violin, or
 * Lineranges, per state.distributionMode). Shown once per exposure metric - not once per
 * endpoint - since dose exposure itself doesn't depend on which response endpoint you're
 * looking at.
 *
 * When `splitByEndpoints` is given (2+ endpoints, "Compare endpoints" mode), each dose is instead
 * split into one sub-row per endpoint, colored by that endpoint and clustered together (dose
 * name + Group N shown once per cluster, on the first sub-row) - since each endpoint has its own
 * responder count even though the exposure values are identical across endpoints for a given
 * dose. All of a dose's sub-rows share the same groupId, so clicking any of them toggles that
 * whole dose cluster together, same as the plain single-row view. */
/** Raw per-row input for the exposure-by-dose distribution strip, before this file computes its
 * KDE/box-height shape geometry - one entry per dose (or, in "Compare endpoints"'s split view,
 * one entry per dose x endpoint sub-row). Mirrors the now-retired `renderDistributionChart`'s own
 * `DistributionGroupInput`. */
interface DistributionRawGroup {
  groupId: string | number;
  label: string;
  color: string;
  values: number[];
  n: number;
  nResponders?: number;
  selected?: boolean;
  skipShape?: boolean;
  selectionColor?: string;
  splitAnnotations?: DistributionSplitAnnotation[];
}

/** Distribution chart's default margin - deliberately different from the scatter charts' own
 * default (`top: 30` vs `22`) since this chart has no y-axis eating into the top margin the way a
 * "0"/"1" (or numeric) y-axis label does. Must stay in sync with the `margin` actually passed to
 * `SVGRenderer.render()` below, since `computeDistributionGroupData` needs the same
 * `boxHalfHeightPx` the `DistributionLayer` will independently (re-)compute from `plotRect.height`
 * - both sides derive it from the same `band = plotHeight / groups.length` formula. */
const DISTRIBUTION_MARGIN = { top: 22, right: 44, bottom: 56, left: 96 };

/** The x-sample grid a group's KDE/box shape is traced over: an even base grid across the whole
 * domain, plus the group's own distribution breakpoints so box edges land exactly on
 * q1/q3/whiskers instead of being snapped to the nearest grid point. Ported verbatim from the
 * now-retired `renderDistributionChart`'s private `buildSampleGrid`. */
function buildDistributionSampleGrid(xDomain: [number, number], stepBreakpoints: number[], baseCount: number): number[] {
  const [lo, hi] = xDomain;
  const span = hi - lo || 1;
  const eps = span * 1e-4;
  const base = Array.from({ length: baseCount + 1 }, (_, i) => lo + (span * i) / baseCount);
  // each step breakpoint gets a "just before" and "just after" point (rather than one point
  // exactly on the boundary) so the box profile can jump vertically there instead of sloping
  const stepPairs = stepBreakpoints.filter((v) => isFinite(v)).flatMap((v) => [v - eps, v + eps]);
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const rounded = [...base, ...stepPairs.map(clamp)].map((v) => Math.round(v * 1e6) / 1e6);
  return [...new Set(rounded)].sort((a, b) => a - b);
}

/** Stepped box-profile half-heights (pixels) over `xSamples`: full box height within [q1,q3], a
 * thin 1px whisker sliver within [whiskerLow,whiskerHigh], zero elsewhere - the traditional
 * boxplot convention (the box spans exactly Q1-Q3, and a hairline connects it to the 1.5*IQR
 * whisker bound). Ported verbatim from the now-retired `renderDistributionChart`'s exported
 * `boxHalfHeightsPx`. */
function distributionBoxHalfHeights(
  summary: { q1: number; q3: number; whiskerLow: number; whiskerHigh: number },
  xSamples: number[],
  boxHalfHeightPx: number
): number[] {
  const whiskerHalfHeightPx = 1;
  return xSamples.map((x) => {
    if (x >= summary.q1 && x <= summary.q3) return boxHalfHeightPx;
    if (x >= summary.whiskerLow && x <= summary.whiskerHigh) return whiskerHalfHeightPx;
    return 0;
  });
}

/**
 * Computes one group's `DistributionLayer` shape geometry from its raw exposure values - the KDE
 * bandwidth/quantile computation `@er-explorer/renderer` deliberately never does itself (its
 * dependency rule: that package imports from `@er-explorer/domain` only, never
 * `@er-explorer/analysis`). Returns `null` for a group with no values (mirrors the old
 * `renderDistributionChart`'s handling of an empty/absent `DistributionSummary`).
 *
 * The KDE's own sample grid only spans this group's own data range (+ a small bandwidth-based
 * pad for a natural taper), not the shared chart-wide `xDomain` - otherwise the shape (and its
 * flat "violin mode" baseline) would stretch as a stray flat line across x-values the group has
 * no data anywhere near, instead of tapering down to nothing right around its own min/max.
 */
function computeDistributionGroupData(
  values: number[],
  xDomain: [number, number],
  boxHalfHeightPx: number,
  baseCount = 60
): { xSamples: number[]; boxHalfHeights: number[]; densityHalfHeights: number[]; summary: NonNullable<ReturnType<typeof summarizeDistribution>> } | null {
  const summary = summarizeDistribution(values);
  if (!summary) return null;
  const bandwidth = silvermanBandwidth(values);
  const pad = Math.max(bandwidth * 2.5, (summary.max - summary.min) * 0.02);
  const localDomain: [number, number] = [Math.max(xDomain[0], summary.min - pad), Math.min(xDomain[1], summary.max + pad)];
  const xSamples = buildDistributionSampleGrid(
    localDomain,
    [summary.whiskerLow, summary.q1, summary.q3, summary.whiskerHigh, summary.min, summary.max],
    baseCount
  );
  const rawDensity = kernelDensityEstimate(values, xSamples, bandwidth);
  const boxHalfHeights = distributionBoxHalfHeights(summary, xSamples, boxHalfHeightPx);
  // normalized per-group (classic violin convention): each violin's own peak maps to the same
  // max width, so shape is comparable across groups regardless of absolute density scale
  const groupMaxDensity = Math.max(1e-9, ...rawDensity);
  const densityHalfHeights = rawDensity.map((d) => (d / groupMaxDensity) * boxHalfHeightPx);
  return { xSamples, boxHalfHeights, densityHalfHeights, summary };
}

/**
 * Renders the exposure-by-dose distribution strip (Boxplot/Violin/Lineranges, per `mode`) via
 * `@er-explorer/renderer` - the Phase 6 cutover off `packages/visualization-engine`'s
 * `renderDistributionChart`. Composes the already-generic `Grid`/`Axis`/`Annotation` layers with
 * the new `DistributionLayer`, which draws the actual per-row shapes.
 *
 * One intentional visual difference from the old output (same kind already accepted in Phase 1's
 * axis-paint-order note): the x-axis label sits ~4px higher than the old renderer's hardcoded
 * `height - 12`, since it now reuses `AxisLayer`'s own default label offset rather than
 * duplicating a bespoke position just for this one caller.
 */
function renderDistributionViaRenderer(
  rawGroups: DistributionRawGroup[],
  xDomain: [number, number],
  mode: DistributionMode,
  referenceLines: ReferenceLine[],
  xAxisLabel: string,
  width: number,
  height: number
): { content: string; metadata: DistributionMeta } {
  const margin = DISTRIBUTION_MARGIN;
  const plotHeight = height - margin.top - margin.bottom;
  const band = plotHeight / Math.max(1, rawGroups.length);
  const boxHalfHeightPx = Math.min(22, band * 0.24);

  const groups: DistributionGroupDatum[] = rawGroups.map((g) => {
    const computed = g.skipShape ? null : computeDistributionGroupData(g.values, xDomain, boxHalfHeightPx);
    return {
      groupId: g.groupId,
      label: g.label,
      color: g.color,
      n: g.n,
      nResponders: g.nResponders,
      selected: g.selected,
      selectionColor: g.selectionColor,
      skipShape: g.skipShape,
      splitAnnotations: g.splitAnnotations,
      xSamples: computed?.xSamples,
      boxHalfHeights: computed?.boxHalfHeights,
      densityHalfHeights: computed?.densityHalfHeights,
      summary: computed?.summary
    };
  });

  const layers: RendererLayer[] = [
    new GridLayer({ id: "grid", yTickValues: [] }),
    new AxisLayer({ id: "axis-x", orientation: "x", label: xAxisLabel }),
    new DistributionLayer({ id: "distribution", mode, groups })
  ];

  if (referenceLines.length) {
    // The distribution chart always prints the split value beneath the line (unlike the scatter
    // charts' optional `showSplitValue` toggle) - matches the old renderDistributionChart's
    // hardcoded `showValueAtBottom = true`.
    const refSpecs: ReferenceLineSpec[] = referenceLines.map((ref) => ({
      value: ref.value,
      label: ref.label,
      valueLabel: ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1)
    }));
    layers.push(new AnnotationLayer({ id: "reference-lines", lines: refSpecs }));
  }

  const result = new SVGRenderer().render({ width, height, xDomain, yDomain: [0, 1], margin, layers });
  const layerData = result.metadata.layerData["distribution"] as DistributionLayerData;

  return {
    content: result.content as string,
    metadata: {
      xScale: { domain: [...result.metadata.xScale.domain], range: [...result.metadata.xScale.range] },
      groups: layerData.groups,
      boxHalfHeightPx: layerData.boxHalfHeightPx
    }
  };
}

interface DistributionMeta {
  xScale: { domain: [number, number]; range: [number, number] };
  groups: DistributionGroupMeta[];
  boxHalfHeightPx: number;
}

/**
 * Optional alternate view (only offered with 2+ endpoints selected): instead of one dose-colored
 * row per endpoint, overlays every selected endpoint's curve/band/observed-marker together in a
 * single "(all)" panel per exposure metric - colored and dashed by endpoint instead of dose. Any
 * number of exposure metrics can be selected; each gets its own overlay column in the same row
 * (mirroring the regular grid's one-column-per-metric layout), rather than multiplying into a
 * full endpoints x metrics grid.
 */
function computeCompareObservedBins(metric: ExposureMetric, endpoint: Endpoint): ObservedResponseBin[] {
  const neutral = compareDistUsesNeutralShapes();
  const color = neutral ? NEUTRAL_COMPARE_COLOR : endpointColor(endpoint);
  const strokeDash = neutral ? endpointMarkerDash(endpoint) : undefined;
  if (usesLinearModel(endpoint)) {
    return computeObservedMeanBins(metric, endpoint).map((b) => {
      const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
      return {
        x: b.x,
        proportion: normCompareValue(b.mean, endpoint),
        ciLower: normCompareValue(b.ciLower, endpoint),
        ciUpper: normCompareValue(b.ciUpper, endpoint),
        n: b.n,
        responders: 0,
        color,
        strokeDash,
        primaryLabel: fmt(b.mean),
        secondaryLabel: `[${fmt(b.ciLower)}–${fmt(b.ciUpper)}] n=${b.n}`
      };
    });
  }
  return computeObservedResponseBins(metric, endpoint).map((b) => ({ ...b, color, strokeDash }));
}

function renderEndpointLegend(endpoints: Endpoint[]): void {
  endpointLegendEl.innerHTML = "";
  const ds = requireDataset();
  endpoints.forEach((endpoint) => {
    const item = document.createElement("div");
    item.className = "dotKey";
    const color = endpointColor(endpoint);
    const dash = endpointDash(endpoint);
    const linear = usesLinearModel(endpoint);
    const bounds = linear ? getCompareNormBounds(endpoint) : null;
    const scaleNote =
      linear && bounds?.valid
        ? ` · scaled ${bounds.min.toFixed(1)}–${bounds.max.toFixed(1)}`
        : linear
          ? " · scale invalid"
          : " · binary";
    item.innerHTML = `<svg width="24" height="10" style="flex:none"><line x1="1" y1="5" x2="23" y2="5" stroke="${color}" stroke-width="2.4" stroke-dasharray="${dash}" stroke-linecap="round" /></svg> ${escapeHtml(ds.endpointLabel(endpoint))}<span class="muted">${scaleNote}</span>`;
    endpointLegendEl.appendChild(item);
  });
}

function renderLegend(): void {
  const ds = requireDataset();
  legendEl.innerHTML = "";
  for (const dose of DOSE_ORDER()) {
    const item = document.createElement("div");
    item.className = "dotKey";
    item.innerHTML = `<span class="swatch" style="background:${resolveDoseColor(dose)}"></span> ${dose}`;
    legendEl.appendChild(item);
  }
}

/** Whether the currently-rendered view is the endpoint-comparison overlay (curves colored by
 * endpoint, not dose) - mirrors the same eligibility check used in render()/
 * renderEndpointComparisonRow. Used to avoid coloring dose names by DOSE_COLORS in text that sits
 * near that view, since a dose no longer maps to a single color there (it's split by endpoint). */
function isEndpointComparisonActive(): boolean {
  const endpoints = selectedEndpoints();
  // Mirrors comparisonEligible in render() - Compare endpoints now works with any number of
  // exposure metrics (each gets its own overlaid "(all)" column), so this must not require
  // exactly one metric to be selected the way it used to before that redesign.
  return state.compareEndpoints && endpoints.length > 1;
}

function doseColorFor(dose: string): string {
  if (isEndpointComparisonActive()) return DOSE_SELECTION_NEUTRAL;
  return resolveDoseColor(dose);
}

function doseSelectionAccentForDistribution(): string | undefined {
  return isEndpointComparisonActive() ? DOSE_SELECTION_NEUTRAL : undefined;
}

function updateStatus(activeCount: number): void {
  const ds = requireDataset();
  const total = ds.rowCount;
  const filterHtml =
    state.dataFilters.length > 0
      ? describeActiveFilters(state.dataFilters, (col) => filterColumnOptions().find((c) => c.id === col)?.label ?? col)
      : "";
  const doseNamesHtml = isEndpointComparisonActive()
    ? [...state.selectedDoses].map((dose) => escapeHtml(dose)).join(", ")
    : [...state.selectedDoses]
        .map((dose) => `<strong style="color:${resolveDoseColor(dose)}">${escapeHtml(dose)}</strong>`)
        .join(", ");
  const focusHtml = state.selectedDoses.size ? `dose = ${doseNamesHtml}` : "";
  const brushText = state.brushedIds ? `${state.brushedIds.size} brushed` : "";
  const parts = [filterHtml, brushText, focusHtml].filter(Boolean);
  if (parts.length) {
    statusEl.innerHTML = parts.join(" · ") + ` (${activeCount} of ${total} rows)`;
  } else {
    const filtered = dataFilteredRowIndices().length;
    if (state.dataFilters.length && filtered < total) {
      statusEl.textContent = `Showing ${filtered} of ${total} rows (filters active)`;
    } else {
      statusEl.textContent = "Showing all rows";
    }
  }
}

/** Renders one row per selected endpoint in the top "Responders by endpoint" card, each split
 * into Placebo vs Dosed (all non-placebo patients pooled) - a single pooled rate across every
 * dose would blend a very different baseline (Placebo) into the treated-population rate, and
 * previously this card only ever reflected one endpoint even when several were selected. */
function updateKpis(activeCount: number, endpoints: Endpoint[]): void {
  const ds = requireDataset();
  kpiN.textContent = String(ds.rowCount);
  kpiShowing.textContent = String(activeCount);
  if (kpiDoses) kpiDoses.textContent = String(DOSE_ORDER().length);

  const placeboRows = rowIndicesPlacebo();
  const dosedRows = rowIndicesDosed();
  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  kpiRespondersBody.innerHTML = endpoints
    .map((endpoint) => {
      if (isContinuousEndpoint(endpoint)) {
        const placeboVals = placeboRows.filter((i) => Number.isFinite(endpointValue(i, endpoint))).map((i) => endpointValue(i, endpoint));
        const dosedVals = dosedRows.filter((i) => Number.isFinite(endpointValue(i, endpoint))).map((i) => endpointValue(i, endpoint));
        const placeboMci = meanConfidenceInterval(placeboVals);
        const dosedMci = meanConfidenceInterval(dosedVals);
        const fmt = (m: { mean: number; lower: number; upper: number }) => `${m.mean.toFixed(1)} [${m.lower.toFixed(1)}-${m.upper.toFixed(1)}]`;
        return `<div class="responder-row">
          <span class="responder-endpoint">${endpoint.toUpperCase()}</span>
          <span class="responder-group"><span class="muted">Placebo</span> <strong>${fmt(placeboMci)}</strong> <span class="muted">(n=${placeboMci.n})</span></span>
          <span class="responder-group"><span class="muted">Dosed</span> <strong>${fmt(dosedMci)}</strong> <span class="muted">(n=${dosedMci.n})</span></span>
        </div>`;
      }
      const placeboResponders = placeboRows.filter((i) => endpointValue(i, endpoint) === 1).length;
      const dosedResponders = dosedRows.filter((i) => endpointValue(i, endpoint) === 1).length;
      return `<div class="responder-row">
        <span class="responder-endpoint">${endpoint.toUpperCase()}</span>
        <span class="responder-group"><span class="muted">Placebo</span> <strong>${pct(placeboResponders, placeboRows.length)}%</strong> <span class="muted">(${placeboResponders}/${placeboRows.length})</span></span>
        <span class="responder-group"><span class="muted">Dosed</span> <strong>${pct(dosedResponders, dosedRows.length)}%</strong> <span class="muted">(${dosedResponders}/${dosedRows.length})</span></span>
      </div>`;
    })
    .join("");
}

/** `endpoints` is normally a single-item array (the regular per-endpoint-row view, where the fit
 * is unambiguous); with 2+ endpoints it carries every one of them and renders one line per
 * endpoint (each labeled "<dose> · <ENDPOINT>" so its fit values are never ambiguous). Only in
 * actual "Compare endpoints" mode - where several endpoints' curves are overlaid together on one
 * axis and therefore colored by endpoint to tell them apart - are these lines colored by
 * ENDPOINT_COLORS to match. In the regular per-endpoint-row view each endpoint already has its
 * own panel/axis above, so there's nothing to disambiguate by color there; every line for a given
 * dose instead stays in that dose's own color (or neutral, in Compare endpoints - see
 * doseColorFor), matching the dose swatches/boxplot rows elsewhere in the UI. */
function updateReadout(
  readoutEl: HTMLDivElement,
  metric: ExposureMetric,
  endpoints: Endpoint[],
  active: Set<number>,
  opts?: { omitEndpointFit?: boolean }
): void {
  const ds = requireDataset();
  const omitEndpointFit = opts?.omitEndpointFit ?? false;
  const groupStats: Record<string, { min: number; q1: number; median: number; q3: number; max: number }> = {};
  const doseN: Record<string, number> = {};
  for (const dose of state.selectedDoses) {
    const rows = rowIndicesForDose(dose).filter((i) => active.has(ds.patientId(i)));
    doseN[dose] = rows.length;
    const vals = rows.map((i) => exposureValue(i, metric)).sort((a, b) => a - b);
    const s = summarizeDistribution(vals);
    if (s) groupStats[dose] = { min: s.min, q1: s.q1, median: s.median, q3: s.q3, max: s.max };
  }
  const doses = [...state.selectedDoses].filter((d) => groupStats[d]);
  if (!doses.length) {
    readoutEl.innerHTML = '<span class="muted">Click a box above to show projected fit values at Min, Q1, Median, Q3, and Max.</span>';
    return;
  }
  const multiEndpoint = endpoints.length > 1;
  const colorByEndpoint = isEndpointComparisonActive();
  const blocks: string[] = [];
  for (const dose of doses) {
    const g = groupStats[dose];
    const doseColor = isEndpointComparisonActive() ? DOSE_SELECTION_NEUTRAL : doseColorFor(dose);
    const expLine = `<div class="readout-line-exposure"><strong style="color:${doseColor}">${escapeHtml(dose)}</strong> &nbsp; Min ${exposureLabel(metric)} = ${g.min.toFixed(1)} &nbsp; Q1 = ${g.q1.toFixed(1)} &nbsp; Median = ${g.median.toFixed(1)} &nbsp; Q3 = ${g.q3.toFixed(1)} &nbsp; Max = ${g.max.toFixed(1)} &nbsp; N=${doseN[dose]}</div>`;
    blocks.push(expLine);

    if (omitEndpointFit) continue;

    for (const endpoint of endpoints) {
      const { fit } = fitFor(metric, endpoint);
      const continuous = isContinuousEndpoint(endpoint);
      const decimals = continuous ? 1 : 3;
      const fitAt = (x: number) =>
        fit.kind === "linear" ? fit.model.intercept + fit.model.slope * x : 1 / (1 + Math.exp(-(fit.model.intercept + fit.model.slope * x)));
      const color = colorByEndpoint ? endpointColor(endpoint) : doseColor;
      const label = multiEndpoint ? ds.endpointLabel(endpoint) : dose;
      const endpointN = rowIndicesForDose(dose).filter(
        (i) => active.has(ds.patientId(i)) && Number.isFinite(endpointValue(i, endpoint))
      ).length;
      const missing = doseN[dose] - endpointN;
      const nNote =
        missing === 0
          ? ""
          : ` &nbsp; <span class="muted">${missing} missing from N=${doseN[dose]}</span>`;
      blocks.push(
        `<div class="readout-line-fit"><span style="color:${color}">${label}</span> — fit @ Min ${fitAt(g.min).toFixed(decimals)} · Q1 ${fitAt(g.q1).toFixed(decimals)} · Med ${fitAt(g.median).toFixed(decimals)} · Q3 ${fitAt(g.q3).toFixed(decimals)} · Max ${fitAt(g.max).toFixed(decimals)}${nNote}</div>`
      );
    }
  }
  readoutEl.innerHTML = blocks.join("");
  applyReadoutChrome(readoutEl);
}

function attachScatterInteractivity(chartWrap: HTMLDivElement, tip: HTMLDivElement, metric: ExposureMetric, endpoint: Endpoint, _meta: ScatterMeta): void {
  const svg = chartWrap.querySelector("svg");
  if (!svg) return;

  svg.addEventListener("pointermove", (ev) => {
    const markerHit = (ev.target as Element).closest(".er-marker-hit");
    if (markerHit) {
      const rectBounds = chartWrap.getBoundingClientRect();
      tip.style.left = `${ev.clientX - rectBounds.left}px`;
      tip.style.top = `${ev.clientY - rectBounds.top}px`;
      tip.style.opacity = "1";
      const raw = markerHit.getAttribute("data-er-marker-tip") ?? "";
      tip.innerHTML = raw
        .split("\n")
        .map((line) => escapeHtml(line))
        .join("<br>");
      return;
    }
    const target = (ev.target as Element).closest("circle[data-id]") as SVGCircleElement | null;
    if (!target) {
      tip.style.opacity = "0";
      return;
    }
    const rectBounds = chartWrap.getBoundingClientRect();
    tip.style.left = `${ev.clientX - rectBounds.left}px`;
    tip.style.top = `${ev.clientY - rectBounds.top}px`;
    tip.style.opacity = "1";
    const tipText = target.getAttribute("data-tip");
    if (tipText) {
      tip.innerHTML = tipText
        .split(" · ")
        .map((line) => escapeHtml(line))
        .join("<br>");
      return;
    }
    const exposure = target.getAttribute("data-exposure");
    const response = target.getAttribute("data-response");
    const group = target.getAttribute("data-group");
    tip.innerHTML = `${escapeHtml(exposureLabel(metric))}: ${Number(exposure).toFixed(1)}<br>${escapeHtml(endpoint.toUpperCase())}: ${escapeHtml(response ?? "")}<br>Dose: ${escapeHtml(group ?? "")}`;
  });
  svg.addEventListener("pointerleave", () => (tip.style.opacity = "0"));
}

function attachDistributionInteractivity(
  chartWrap: HTMLDivElement,
  metric: ExposureMetric,
  endpoints: Endpoint[],
  active: Set<number>,
  readoutEl: HTMLDivElement,
  meta: DistributionMeta,
  readoutOpts?: { omitEndpointFit?: boolean }
): void {
  const svg = chartWrap.querySelector("svg");
  updateReadout(readoutEl, metric, endpoints, active, readoutOpts);
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
      refreshSelectionVisuals();
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

  // Lineranges isn't a ridge-path shape (it's a plain line + tick marks), so there's no path to
  // continuously morph to/from the way boxplot and violin can. Cross-fade instead, so the switch
  // still feels animated rather than an abrupt snap.
  if (fromMode === "lineranges" || targetMode === "lineranges") {
    crossFadeDistributionTransition(targetMode);
    return;
  }

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

/** Any transition into/out of Lineranges can't reuse the boxplot<->violin path morph above (there
 * is no shared ridge-path shape to interpolate), so it cross-fades instead: snapshot every
 * currently-rendered distribution chart's SVG, re-render immediately in the target mode, then lay
 * the snapshots on top (fixed-position, sized to match) and fade them out to reveal the new
 * charts underneath. `distributionAnimating` still gates dose-row clicks for the duration, exactly
 * like the path-morph transition does, even though the new (already-interactive) DOM is live
 * underneath the fading snapshot the whole time. */
function crossFadeDistributionTransition(targetMode: DistributionMode): void {
  distributionAnimating = true;
  setDistModeButtonsDisabled(true);
  setDistModeButtonsActive(targetMode);

  const snapshots = Array.from(document.querySelectorAll<HTMLDivElement>(".dist-inline-chart"))
    .map((wrap) => {
      const svg = wrap.querySelector("svg");
      return svg ? { svg: svg.cloneNode(true) as SVGElement, rect: wrap.getBoundingClientRect() } : null;
    })
    .filter((s): s is { svg: SVGElement; rect: DOMRect } => s !== null);

  state.distributionMode = targetMode;
  render();

  const overlayHost = document.createElement("div");
  overlayHost.style.cssText = "position:fixed; inset:0; pointer-events:none; z-index:9999;";
  document.body.appendChild(overlayHost);
  const overlays = snapshots.map(({ svg, rect }) => {
    const div = document.createElement("div");
    div.style.cssText = `position:absolute; left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px;`;
    div.appendChild(svg);
    overlayHost.appendChild(div);
    return div;
  });

  const duration = 420;
  const start = performance.now();
  function frame(now: number): void {
    const t = Math.min(1, (now - start) / duration);
    const opacity = String(1 - easeInOutCubic(t));
    overlays.forEach((o) => (o.style.opacity = opacity));
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      overlayHost.remove();
      distributionAnimating = false;
      setDistModeButtonsDisabled(false);
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
 * Dataset upload / column mapping
 * ---------------------------------------------------------------------- */

function syncEndpointModelsUi(): void {
  if (!dataset) {
    endpointModelsListEl.innerHTML = "";
    return;
  }
  const ds = dataset;
  const endpoints = endpointOrder();
  endpointModelsListEl.innerHTML = endpoints
    .map((e) => {
      const model = state.endpointModels[e] ?? inferDefaultEndpointModel(ds, e);
      return `<div class="endpoint-model-row" data-endpoint="${escapeAttr(e)}">
        <span>${escapeHtml(ds.endpointLabel(e))}</span>
        <select data-endpoint-model="${escapeAttr(e)}">
          <option value="logistic" ${model === "logistic" ? "selected" : ""}>Logistic</option>
          <option value="linear" ${model === "linear" ? "selected" : ""}>Linear</option>
        </select>
      </div>`;
    })
    .join("");
  endpointModelsListEl.querySelectorAll<HTMLSelectElement>("select[data-endpoint-model]").forEach((sel) => {
    sel.onchange = () => {
      const ep = sel.dataset.endpointModel as Endpoint | undefined;
      if (!ep) return;
      const val = sel.value === "linear" ? "linear" : "logistic";
      state.endpointModels[ep] = val;
      if (val === "linear") ensureNormScaleForEndpoint(ep);
      syncCompareNormUi(selectedEndpoints(), state.compareEndpoints && selectedEndpoints().length > 1);
      render();
    };
  });
}

function syncCompareNormUi(endpoints: Endpoint[], show: boolean): void {
  if (!dataset || !show) {
    compareNormSectionEl.hidden = true;
    compareNormListEl.innerHTML = "";
    return;
  }
  const ds = dataset;
  const linearEps = endpoints.filter((e) => usesLinearModel(e));
  if (!linearEps.length) {
    compareNormSectionEl.hidden = true;
    compareNormListEl.innerHTML = "";
    return;
  }
  compareNormSectionEl.hidden = false;
  const dataRanges = linearEps.map((e) => ({ e, range: dataRangeForEndpoint(ds, e) }));
  compareNormListEl.innerHTML = dataRanges
    .map(({ e, range }) => {
      ensureNormScaleForEndpoint(e);
      const scale = state.endpointNormScales[e]!;
      const resolved = resolveNormBounds(scale, range);
      const dataHint = range ? `data ${range.min.toFixed(1)}–${range.max.toFixed(1)}` : "no data";
      return `<div class="compare-norm-row" data-endpoint="${escapeAttr(e)}">
        <span title="${escapeAttr(dataHint)}">${escapeHtml(ds.endpointLabel(e))}</span>
        <input type="number" step="any" data-norm-min="${escapeAttr(e)}" value="${scale.min}" aria-label="Min ${escapeAttr(e)}" />
        <input type="number" step="any" data-norm-max="${escapeAttr(e)}" value="${scale.max}" aria-label="Max ${escapeAttr(e)}" />
        <button type="button" class="btn-reset-norm" data-norm-reset="${escapeAttr(e)}">Use data</button>
      </div>`;
    })
    .join("");

  compareNormListEl.querySelectorAll<HTMLInputElement>("input[data-norm-min]").forEach((inp) => {
    inp.onchange = () => applyNormInput(inp.dataset.normMin as Endpoint, "min", inp.value);
  });
  compareNormListEl.querySelectorAll<HTMLInputElement>("input[data-norm-max]").forEach((inp) => {
    inp.onchange = () => applyNormInput(inp.dataset.normMax as Endpoint, "max", inp.value);
  });
  compareNormListEl.querySelectorAll<HTMLButtonElement>("button[data-norm-reset]").forEach((btn) => {
    btn.onclick = () => {
      const ep = btn.dataset.normReset as Endpoint;
      if (!dataset || !ep) return;
      const range = dataRangeForEndpoint(dataset, ep);
      if (!range) return;
      state.endpointNormScales[ep] = { min: range.min, max: range.max, useCustomBounds: false };
      syncCompareNormUi(selectedEndpoints(), true);
      render();
    };
  });
}

function applyNormInput(endpoint: Endpoint, field: "min" | "max", raw: string): void {
  const n = Number(raw);
  if (!Number.isFinite(n) || !dataset) return;
  ensureNormScaleForEndpoint(endpoint);
  const scale = state.endpointNormScales[endpoint]!;
  scale.useCustomBounds = true;
  if (field === "min") scale.min = n;
  else scale.max = n;
  render();
}

function syncFiltersUi(): void {
  if (!dataset) {
    filterRulesListEl.innerHTML = "";
    filterStatusEl.textContent = "";
    return;
  }
  const cols = filterColumnOptions();
  const colById = new Map(cols.map((c) => [c.id, c]));

  filterRulesListEl.innerHTML = state.dataFilters
    .map((rule, idx) => {
      const col = colById.get(rule.column) ?? cols[0];
      if (rule.categorical === undefined && col) rule.categorical = suggestFilterMode(col);
      const categorical = rule.categorical ?? false;
      const colOptions = cols.map((c) => `<option value="${escapeAttr(c.id)}" ${c.id === rule.column ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("");
      const ops = filterOperatorsForColumn(categorical ? false : (col?.numeric ?? false))
        .map((o) => `<option value="${o.value}" ${o.value === rule.operator ? "selected" : ""}>${escapeHtml(o.label)}</option>`)
        .join("");
      const distinct = col ? distinctColumnValues(dataset!.loaded, col.id, 50) : [];
      const selectedSet = new Set(rule.values);
      const catPickers =
        categorical && distinct.length
          ? `<div class="filter-cat-values">${distinct
              .map(
                (v) =>
                  `<label><input type="checkbox" data-filter-cat-val="${escapeAttr(rule.id)}" value="${escapeAttr(v)}" ${selectedSet.has(v) ? "checked" : ""} /> ${escapeHtml(v)}</label>`
              )
              .join("")}</div>`
          : `<input class="filter-values-input" data-filter-val="${escapeAttr(rule.id)}" value="${escapeHtml(rule.values.join(", "))}" placeholder="${categorical ? "Pick values above or type" : col?.numeric ? "e.g. 340" : "comma-separated"}" />`;
      return `<div class="filter-rule" data-rule-id="${escapeAttr(rule.id)}">
        <div class="filter-rule-head"><span>Rule ${idx + 1}</span>
          <button type="button" class="btn-reset-norm" data-remove-filter="${escapeAttr(rule.id)}">Remove</button></div>
        <div class="filter-rule-row">
          <select data-filter-col="${escapeAttr(rule.id)}">${colOptions}</select>
          <div class="filter-mode-row"><label><input type="checkbox" data-filter-cat-mode="${escapeAttr(rule.id)}" ${categorical ? "checked" : ""} /> Categorical (pick values)</label></div>
          <select data-filter-op="${escapeAttr(rule.id)}" ${categorical ? "" : ""}>${ops}</select>
          ${catPickers}
        </div>
      </div>`;
    })
    .join("");

  const n = dataFilteredRowIndices().length;
  const total = dataset.rowCount;
  filterStatusEl.textContent = state.dataFilters.length ? `${n} of ${total} rows pass filters.` : `${total} rows (no filters).`;

  filterRulesListEl.querySelectorAll<HTMLSelectElement>("select[data-filter-col]").forEach((sel) => {
    sel.onchange = () => {
      const id = sel.dataset.filterCol;
      const rule = state.dataFilters.find((r) => r.id === id);
      if (!rule) return;
      rule.column = sel.value;
      const c = colById.get(rule.column);
      rule.categorical = c ? suggestFilterMode(c) : false;
      const ops = filterOperatorsForColumn(rule.categorical ? false : (c?.numeric ?? false));
      if (!ops.some((o) => o.value === rule.operator)) rule.operator = ops[0]!.value;
      syncFiltersUi();
      render();
    };
  });
  filterRulesListEl.querySelectorAll<HTMLInputElement>("input[data-filter-cat-mode]").forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.filterCatMode;
      const rule = state.dataFilters.find((r) => r.id === id);
      if (!rule) return;
      rule.categorical = cb.checked;
      if (rule.categorical) {
        rule.operator = rule.operator === "notIn" ? "notIn" : "in";
      }
      syncFiltersUi();
      render();
    };
  });
  filterRulesListEl.querySelectorAll<HTMLInputElement>("input[data-filter-cat-val]").forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.filterCatVal;
      const rule = state.dataFilters.find((r) => r.id === id);
      if (!rule) return;
      const checked = [...filterRulesListEl.querySelectorAll<HTMLInputElement>(`input[data-filter-cat-val="${id}"]:checked`)].map(
        (el) => el.value
      );
      rule.values = checked;
      render();
    };
  });
  filterRulesListEl.querySelectorAll<HTMLSelectElement>("select[data-filter-op]").forEach((sel) => {
    sel.onchange = () => {
      const id = sel.dataset.filterOp;
      const rule = state.dataFilters.find((r) => r.id === id);
      if (!rule) return;
      rule.operator = sel.value as FilterOperator;
      render();
    };
  });
  filterRulesListEl.querySelectorAll<HTMLInputElement>("input[data-filter-val]").forEach((inp) => {
    inp.onchange = () => {
      const id = inp.dataset.filterVal;
      const rule = state.dataFilters.find((r) => r.id === id);
      if (!rule) return;
      rule.values = inp.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      render();
    };
  });
  filterRulesListEl.querySelectorAll<HTMLButtonElement>("button[data-remove-filter]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.removeFilter;
      state.dataFilters = state.dataFilters.filter((r) => r.id !== id);
      syncFiltersUi();
      render();
    };
  });
}

function syncMetricEndpointControls(): void {
  if (!dataset) return;
  const ds = dataset;
  const metrics = exposureOrder();
  const endpoints = endpointOrder();
  if (!state.exposureMetrics.size || ![...state.exposureMetrics].some((m) => metrics.includes(m))) {
    state.exposureMetrics = new Set(metrics.slice(0, 1));
  }
  if (!state.endpoints.size || ![...state.endpoints].some((e) => endpoints.includes(e))) {
    state.endpoints = new Set(endpoints.slice(0, 1));
  }

  mountSortableFieldList(
    exposureGroupEl,
    metrics,
    state.exposureMetrics,
    (m) => ds.exposureLabel(m),
    (nextOrder, nextSelected) => {
      state.exposureColumnOrder = nextOrder;
      state.exposureMetrics = nextSelected;
      state.brushedIds = null;
      render();
    }
  );

  mountSortableFieldList(
    endpointGroupEl,
    endpoints,
    state.endpoints,
    (e) => ds.endpointLabel(e),
    (nextOrder, nextSelected) => {
      state.endpointColumnOrder = nextOrder;
      state.endpoints = nextSelected;
      state.brushedIds = null;
      syncCompareNormUi([...nextSelected], state.compareEndpoints && nextSelected.size > 1);
      render();
    }
  );

  syncEndpointModelsUi();
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}


function syncOverlayControlsFromState(): void {
  setRefLineRadio(state.referenceLineKind);
  splitAnnotationModeEl.value = state.splitAnnotationMode;
  showObservedRespEl.checked = state.showObservedResponders;
  showReferenceFitEl.checked = state.showReferenceFit;
  showFittedAtObservedBinEl.checked = state.showFittedAtObservedBin;
  showSplitValueEl.checked = state.showSplitValue;
  showDoseObservedEl.checked = state.showDoseObserved;
  showDistReadoutEl.checked = state.showDistReadout;
  expandDistReadoutEl.checked = state.distReadoutExpanded;
}

/** Richer default overlays when loading the bundled effICGI walkthrough. */
function applyExampleExploreDefaults(ds: DatasetContext): void {
  state.exposureMetrics = new Set(["auc", "cmax"]);
  state.endpoints = new Set(["icgi"]);
  state.exposureColumnOrder = mergeColumnOrder(["cmax", "auc"], ds.exposureOrder());
  state.endpointColumnOrder = [...ds.endpointOrder()];
  state.referenceLineKind = "tertiles";
  state.splitAnnotationMode = "n_pct";
  state.showObservedResponders = true;
  state.showSplitValue = true;
  state.showDoseObserved = true;
  state.showReferenceFit = false;
  state.distributionMode = "boxplot";
  syncOverlayControlsFromState();
  setDistModeButtonsActive(state.distributionMode);
  syncMetricEndpointControls();
  ensureEndpointAnalysisDefaults();
}

function syncColumnRolesSummary(): void {
  if (!dataset) {
    columnRolesSummaryEl.hidden = true;
    referenceArmFieldEl.hidden = true;
    return;
  }
  const ds = dataset;
  const items = ds.loaded.variableOrder
    .map((col) => {
      const role = ds.columnRoles[col] ?? "ignore";
      if (role === "ignore") return "";
      return `<li><span class="col-name">${escapeHtml(col)}</span><span class="col-role">${escapeHtml(role)}</span></li>`;
    })
    .filter(Boolean);
  columnRolesListEl.innerHTML = items.length
    ? items.join("")
    : `<li><span class="col-name muted">No mapped columns</span></li>`;
  columnRolesSummaryEl.hidden = false;
  referenceArmFieldEl.hidden = false;
  syncReferenceArmUi();
}

function activateDataset(next: DatasetContext, statusMessage?: string, options?: { focusPlot?: boolean }): void {
  dataset = next;
  state.exposureColumnOrder = [...next.exposureOrder()];
  state.endpointColumnOrder = [...next.endpointOrder()];
  state.brushedIds = null;
  state.selectedDoses.clear();
  ensureEndpointAnalysisDefaults();
  syncMetricEndpointControls();
  syncFiltersUi();
  mappingPanelEl.style.display = "none";
  pendingCsvRows = null;
  pendingDatasetMeta = null;
  dataStatusEl.textContent = statusMessage ?? `${dataset.datasetName} — ${dataset.rowCount} rows`;
  syncColumnRolesSummary();
  saveSessionBtn.disabled = false;
  setPlotWorkspaceVisible(true);
  if (options?.focusPlot !== false) setShellRail("plot");
  render();
}

function showMappingUi(
  rows: Array<Record<string, import("@er-explorer/data").RawCellValue>>,
  roles: Record<string, DemoColumnRole>,
  meta: PendingDatasetMeta
): void {
  pendingCsvRows = rows;
  pendingColumnRoles = roles;
  pendingDatasetMeta = meta;
  const { loaded, inferred } = buildPendingContext(rows, roles);
  mappingTableBody.innerHTML = loaded.variableOrder
    .map((colId: string) => {
      const inf = inferred[colId];
      const role = roles[colId] ?? "ignore";
      const missingPct = inf ? `${Math.round(inf.missing.missingFraction * 100)}%` : "—";
      const options = DEMO_COLUMN_ROLES.map(
        (r) => `<option value="${r}" ${role === r ? "selected" : ""}>${r}</option>`
      ).join("");
      return `<tr>
        <td>${escapeHtml(colId)}</td>
        <td>${inf?.type ?? "—"}</td>
        <td>${missingPct}</td>
        <td><select data-col="${escapeAttr(colId)}">${options}</select></td>
      </tr>`;
    })
    .join("");
  mappingPanelEl.style.display = "block";
  mappingErrorsEl.textContent = "";
  mappingTableBody.querySelectorAll<HTMLSelectElement>("select[data-col]").forEach((sel) => {
    sel.onchange = () => {
      const col = sel.dataset.col;
      if (col) pendingColumnRoles[col] = sel.value as DemoColumnRole;
    };
  });
}

function applyPendingMapping(): void {
  if (!pendingCsvRows || !pendingDatasetMeta) return;
  mappingErrorsEl.textContent = "";
  try {
    const next = DatasetContext.fromRows(pendingCsvRows, pendingColumnRoles, {
      datasetId: pendingDatasetMeta.datasetId,
      datasetName: pendingDatasetMeta.datasetName
    });
    activateDataset(next, `${pendingDatasetMeta.datasetName} — ${next.rowCount} rows loaded`);
    if (pendingDatasetMeta.applyExampleDefaults) {
      applyExampleExploreDefaults(next);
      render();
    }
  } catch (err) {
    mappingErrorsEl.textContent = err instanceof Error ? err.message : "Could not apply mapping.";
  }
}

function prepareBundledMapping(): void {
  const rows = DatasetContext.bundledRowsFromRecords(RECORDS);
  showMappingUi(rows, { ...EFFICGI_DEFAULT_ROLES }, {
    datasetId: "effICGI-demo-v1",
    datasetName: "Bundled effICGI",
    applyExampleDefaults: true
  });
  setShellRail("data", { force: true });
  dataStatusEl.textContent = `Example effICGI — ${rows.length} rows. Review column roles (same as CSV upload), then Apply mapping & load.`;
}

function openMappingForCurrentDataset(): void {
  if (!dataset) return;
  const rows = rowsFromLoaded(dataset.loaded);
  showMappingUi(rows, { ...dataset.columnRoles }, {
    datasetId: dataset.datasetId,
    datasetName: dataset.datasetName
  });
  setShellRail("data", { force: true });
  dataStatusEl.textContent = `Remap columns for ${dataset.datasetName} (${dataset.rowCount} rows) — no need to re-upload the file.`;
}

function reloadBundledDataset(): void {
  prepareBundledMapping();
}

/* ---------------------------------------------------------------------- *
 * Session save / load
 * ---------------------------------------------------------------------- */

function buildSessionState(): SessionState {
  const ds = requireDataset();
  const metrics = selectedExposureMetrics();
  const endpoints = selectedEndpoints();
  const primaryMetric = metrics[0] ?? "auc";
  const primaryEndpoint = endpoints[0] ?? "icgi";
  const continuous = isContinuousEndpoint(primaryEndpoint);
  const model = createModelDefinition(
    `${primaryEndpoint}-${primaryMetric}-${continuous ? "linear" : "logistic"}`,
    continuous ? "linear" : "logistic",
    `${continuous ? "Linear" : "Logistic"} exposure-response: ${primaryEndpoint.toUpperCase()} ~ ${exposureLabel(primaryMetric)}${
      metrics.length > 1 ? ` (+${metrics.length - 1} more exposure panel(s))` : ""
    }${endpoints.length > 1 ? ` (+${endpoints.length - 1} more endpoint row(s))` : ""}`
  );
  const { fit, xs, ys } = fitFor(primaryMetric, primaryEndpoint);
  const curve = curveFor(fit, xs, ys, exposureXDomain(primaryMetric));
  const visualization = createVisualizationSpec(`${ds.datasetId}-scatter`, model, curve, {
    title: "Exposure vs response",
    xAxisLabel: exposureLabel(primaryMetric),
    yAxisLabel: primaryEndpoint.toUpperCase(),
    renderTarget: "svg"
  });
  const byod = buildByodPayload(ds.loaded, ds.columnRoles, ds.datasetName);
  return createSessionState(
    ds.datasetId,
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
      showFittedAtObservedBin: state.showFittedAtObservedBin,
      showSplitValue: state.showSplitValue,
      showDoseObserved: state.showDoseObserved,
      compareEndpoints: state.compareEndpoints,
      showPoints: state.showPoints,
      gridLayout: state.gridLayout,
      doseColorScheme: state.doseColorScheme,
      endpointColorScheme: state.endpointColorScheme,
      endpointModels: { ...state.endpointModels },
      endpointNormScales: { ...state.endpointNormScales },
      dataFilters: state.dataFilters.map((r) => ({ ...r, values: [...r.values] })),
      compareDistByEndpoint: state.compareDistByEndpoint,
      scatterPaneRatio: state.scatterPaneRatio,
      metricStackHeightPx: state.metricStackHeightPx,
      showDistReadout: state.showDistReadout,
      distReadoutExpanded: state.distReadoutExpanded,
      exposureColumnOrder: state.exposureColumnOrder,
      endpointColumnOrder: state.endpointColumnOrder,
      referenceArmDoses: [...state.referenceArmDoses],
      byod
    }
  );
}

function saveSession(): void {
  if (!dataset) return;
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

      const byodRaw = session.settings["byod"] as ByodSessionPayload | undefined;
      if (byodRaw?.snapshot && byodRaw.columnRoles) {
        const checksumOk = verifySnapshotChecksum(byodRaw.snapshot, byodRaw.snapshotChecksum);
        dataset = DatasetContext.fromSnapshot(byodRaw.snapshot, byodRaw.columnRoles, {
          datasetId: session.datasetId,
          datasetName: byodRaw.datasetName ?? "Session dataset"
        });
        if (!checksumOk) {
          sessionStatus.textContent = "Loaded session (dataset checksum mismatch — data may have been edited).";
        }
      } else if (session.datasetId === "effICGI-demo-v1" || session.datasetId.startsWith("effICGI")) {
        dataset = DatasetContext.fromRecords(RECORDS);
      } else {
        throw new InvalidSessionFileError("Session has no embedded dataset; save a new session after loading CSV or example data.");
      }

      setPlotWorkspaceVisible(true);
      saveSessionBtn.disabled = false;

      state.exposureColumnOrder = [...dataset!.exposureOrder()];
      state.endpointColumnOrder = [...dataset!.endpointOrder()];
      const expOrdSaved = session.settings["exposureColumnOrder"];
      if (Array.isArray(expOrdSaved)) {
        state.exposureColumnOrder = mergeColumnOrder(
          expOrdSaved.filter((m): m is string => typeof m === "string"),
          dataset!.exposureOrder()
        );
      }
      const epOrdSaved = session.settings["endpointColumnOrder"];
      if (Array.isArray(epOrdSaved)) {
        state.endpointColumnOrder = mergeColumnOrder(
          epOrdSaved.filter((e): e is string => typeof e === "string"),
          dataset!.endpointOrder()
        );
      }
      const refArmsSaved = session.settings["referenceArmDoses"];
      if (Array.isArray(refArmsSaved)) {
        state.referenceArmDoses = refArmsSaved.filter((d): d is string => typeof d === "string");
      }

      const ci = session.settings["ciMethod"];
      const metricsRaw = session.settings["exposureMetrics"];
      const legacyMetric = session.settings["exposureMetric"];
      let metrics: ExposureMetric[] = [];
      const knownMetrics = new Set(exposureOrder());
      if (Array.isArray(metricsRaw)) {
        metrics = metricsRaw.filter((m): m is ExposureMetric => typeof m === "string" && knownMetrics.has(m));
      } else if (typeof legacyMetric === "string" && knownMetrics.has(legacyMetric)) {
        metrics = [legacyMetric];
      }
      if (!metrics.length) metrics = exposureOrder().slice(0, 1);
      state.exposureMetrics = new Set(metrics);

      const endpointsRaw = session.settings["endpoints"];
      const legacyEndpoint = session.settings["endpoint"];
      let endpoints: Endpoint[] = [];
      const knownEndpoints = new Set(endpointOrder());
      if (Array.isArray(endpointsRaw)) {
        endpoints = endpointsRaw.filter((e): e is Endpoint => typeof e === "string" && knownEndpoints.has(e));
      } else if (typeof legacyEndpoint === "string" && knownEndpoints.has(legacyEndpoint)) {
        endpoints = [legacyEndpoint];
      }
      if (!endpoints.length) endpoints = endpointOrder().slice(0, 1);
      state.endpoints = new Set(endpoints);

      if (ci === "wald" || ci === "bootstrap" || ci === "none") state.ciMethod = ci;
      if (typeof session.settings["bootstrapSeed"] === "number") state.bootstrapSeed = session.settings["bootstrapSeed"] as number;
      if (typeof session.settings["bootstrapResamples"] === "number") state.bootstrapResamples = session.settings["bootstrapResamples"] as number;
      const distMode = session.settings["distributionMode"];
      if (distMode === "boxplot" || distMode === "violin" || distMode === "lineranges") state.distributionMode = distMode;
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
      state.showFittedAtObservedBin = session.settings["showFittedAtObservedBin"] === true;
      state.showSplitValue = session.settings["showSplitValue"] === true;
      // default true (matches the app's default) so older session files without this key still
      // show the dose-observed marker rather than silently hiding it
      state.showDoseObserved = session.settings["showDoseObserved"] !== false;
      state.compareEndpoints = session.settings["compareEndpoints"] === true;
      state.showPoints = session.settings["showPoints"] !== false;
      const gridRaw = session.settings["gridLayout"];
      if (gridRaw === "endpoint-rows" || gridRaw === "exposure-rows") state.gridLayout = gridRaw;
      const doseScheme = session.settings["doseColorScheme"];
      if (doseScheme === "default" || doseScheme === "tableau" || doseScheme === "set2" || doseScheme === "dark") {
        state.doseColorScheme = doseScheme;
      }
      const epScheme = session.settings["endpointColorScheme"];
      if (epScheme === "default" || epScheme === "tableau" || epScheme === "set2" || epScheme === "dark") {
        state.endpointColorScheme = epScheme;
      }
      const modelsRaw = session.settings["endpointModels"];
      if (modelsRaw && typeof modelsRaw === "object" && !Array.isArray(modelsRaw)) {
        state.endpointModels = { ...(modelsRaw as Record<string, EndpointAnalysisModel>) };
      }
      const normRaw = session.settings["endpointNormScales"];
      if (normRaw && typeof normRaw === "object" && !Array.isArray(normRaw)) {
        state.endpointNormScales = { ...(normRaw as Record<string, EndpointNormScale>) };
      }
      ensureEndpointAnalysisDefaults();
      const filtersRaw = session.settings["dataFilters"];
      if (Array.isArray(filtersRaw)) {
        state.dataFilters = filtersRaw.filter(
          (r): r is DataFilterRule =>
            r &&
            typeof r === "object" &&
            typeof (r as DataFilterRule).id === "string" &&
            typeof (r as DataFilterRule).column === "string"
        );
      }
      if (typeof session.settings["compareDistByEndpoint"] === "boolean") {
        state.compareDistByEndpoint = session.settings["compareDistByEndpoint"] as boolean;
      }
      if (typeof session.settings["scatterPaneRatio"] === "number") {
        state.scatterPaneRatio = session.settings["scatterPaneRatio"] as number;
      }
      if (typeof session.settings["metricStackHeightPx"] === "number") {
        state.metricStackHeightPx = session.settings["metricStackHeightPx"] as number;
        saveMetricStackHeight(state.metricStackHeightPx);
      }
      const brushed = session.filters["brushedIds"];
      state.brushedIds = Array.isArray(brushed) ? new Set(brushed as number[]) : null;
      const doses = session.filters["selectedDoses"];
      state.selectedDoses = new Set(Array.isArray(doses) ? (doses as string[]) : []);

      syncMetricEndpointControls();
      ciSelect.value = state.ciMethod;
      setDistModeButtonsActive(state.distributionMode);
      setRefLineRadio(state.referenceLineKind);
      splitAnnotationModeEl.value = state.splitAnnotationMode;
      showObservedRespEl.checked = state.showObservedResponders;
      showReferenceFitEl.checked = state.showReferenceFit;
      showFittedAtObservedBinEl.checked = state.showFittedAtObservedBin;
      showSplitValueEl.checked = state.showSplitValue;
      showDoseObservedEl.checked = state.showDoseObserved;
      if (typeof session.settings["showDistReadout"] === "boolean") {
        state.showDistReadout = session.settings["showDistReadout"] as boolean;
      }
      if (typeof session.settings["distReadoutExpanded"] === "boolean") {
        state.distReadoutExpanded = session.settings["distReadoutExpanded"] as boolean;
      }
      showDistReadoutEl.checked = state.showDistReadout;
      expandDistReadoutEl.checked = state.distReadoutExpanded;
      compareEndpointsEl.checked = state.compareEndpoints;
      compareDistByEndpointEl.checked = state.compareDistByEndpoint;
      syncFiltersUi();
      showPointsEl.checked = state.showPoints;
      gridLayoutSelect.value = state.gridLayout;
      doseColorSchemeSelect.value = state.doseColorScheme;
      endpointColorSchemeSelect.value = state.endpointColorScheme;
      setShellRail("plot");
      render();
      if (!sessionStatus.textContent?.includes("checksum mismatch")) {
        sessionStatus.textContent = `Loaded session from ${session.metadata.createdAt}.`;
      }
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

initAppShell((rail) => {
  const titles: Record<string, string> = {
    data: "Data",
    filters: "Filters",
    analysis: "Analysis",
    overlays: "Overlays",
    style: "Style",
    plot: "Plot",
    session: "Session"
  };
  const titleEl = document.getElementById("drawerTitle");
  if (titleEl && titles[rail]) titleEl.textContent = titles[rail];
});

document.getElementById("openDataDrawerBtn")?.addEventListener("click", () => setShellRail("data", { force: true }));

setPlotWorkspaceVisible(false);
saveSessionBtn.disabled = true;
dataStatusEl.textContent = "No dataset loaded.";

reloadBundledBtn.addEventListener("click", reloadBundledDataset);
editMappingBtn.addEventListener("click", openMappingForCurrentDataset);
referenceArmDosesEl.addEventListener("change", () => {
  state.referenceArmDoses = referenceArmDosesEl.value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  render();
});
loadCsvBtn.addEventListener("click", () => csvFileInput.click());
csvFileInput.addEventListener("change", () => {
  const file = csvFileInput.files?.[0];
  csvFileInput.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCsv(String(reader.result));
      if (!rows.length) {
        dataStatusEl.textContent = "CSV contained no data rows.";
        return;
      }
      const loaded = loadDataset(rows);
      const roles = inferRolesForColumns(loaded, {});
      showMappingUi(rows, roles, {
        datasetId: `upload-${Date.now()}`,
        datasetName: "Uploaded CSV"
      });
      setShellRail("data", { force: true });
      dataStatusEl.textContent = `Parsed ${rows.length} rows — map columns and apply.`;
    } catch (err) {
      dataStatusEl.textContent = err instanceof Error ? err.message : "Could not parse CSV.";
    }
  };
  reader.readAsText(file);
});
applyMappingBtn.addEventListener("click", applyPendingMapping);

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
showFittedAtObservedBinEl.addEventListener("change", () => {
  state.showFittedAtObservedBin = showFittedAtObservedBinEl.checked;
  render();
});
showSplitValueEl.addEventListener("change", () => {
  state.showSplitValue = showSplitValueEl.checked;
  render();
});
showDoseObservedEl.addEventListener("change", () => {
  state.showDoseObserved = showDoseObservedEl.checked;
  render();
});
showDistReadoutEl.addEventListener("change", () => {
  state.showDistReadout = showDistReadoutEl.checked;
  applyReadoutChrome();
  schedulePaintSyncedMetricStacks(activeSet());
});
expandDistReadoutEl.addEventListener("change", () => {
  state.distReadoutExpanded = expandDistReadoutEl.checked;
  applyReadoutChrome();
  schedulePaintSyncedMetricStacks(activeSet());
});
compareEndpointsEl.addEventListener("change", () => {
  state.compareEndpoints = compareEndpointsEl.checked;
  syncCompareNormUi(selectedEndpoints(), state.compareEndpoints && selectedEndpoints().length > 1);
  render();
});
compareDistByEndpointEl.addEventListener("change", () => {
  state.compareDistByEndpoint = compareDistByEndpointEl.checked;
  refreshSelectionVisuals();
});

addFilterRuleBtn.addEventListener("click", () => {
  if (!dataset) return;
  const cols = filterColumnOptions();
  if (!cols.length) return;
  const col = cols[0]!;
  state.dataFilters.push({
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    column: col.id,
    operator: col.numeric && !suggestFilterMode(col) ? "lt" : "in",
    values: [],
    categorical: suggestFilterMode(col)
  });
  syncFiltersUi();
  render();
});

showPointsEl.addEventListener("change", () => {
  state.showPoints = showPointsEl.checked;
  render();
});
gridLayoutSelect.addEventListener("change", () => {
  const val = gridLayoutSelect.value;
  state.gridLayout = val === "exposure-rows" ? "exposure-rows" : "endpoint-rows";
  render();
});
doseColorSchemeSelect.addEventListener("change", () => {
  const val = doseColorSchemeSelect.value;
  if (val === "default" || val === "tableau" || val === "set2" || val === "dark") {
    state.doseColorScheme = val;
    render();
  }
});
endpointColorSchemeSelect.addEventListener("change", () => {
  const val = endpointColorSchemeSelect.value;
  if (val === "default" || val === "tableau" || val === "set2" || val === "dark") {
    state.endpointColorScheme = val;
    render();
  }
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

// Chart help toggle (header)
document.querySelectorAll<HTMLButtonElement>(".note-toggle").forEach((btn) => {
  const targetId = btn.dataset.target;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) return;
  btn.addEventListener("click", () => {
    const isHidden = target.style.display === "none";
    target.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "Hide help ▴" : "Chart help ▾";
    btn.setAttribute("aria-expanded", String(isHidden));
  });
});

plotStackHeightHandleEl.addEventListener("dblclick", () => {
  setMetricStackHeight(0);
  render();
});

attachPlotStackHeightResizer(
  plotStackHeightHandleEl,
  () => {
    if (state.metricStackHeightPx > 0) return state.metricStackHeightPx;
    const facet = document.querySelector(".facet-layout") ?? document.querySelector(".metric-stack");
    return facet ? Math.round(facet.getBoundingClientRect().height) : 480;
  },
  (px) => setMetricStackHeight(px, false),
  () => {
    saveMetricStackHeight(state.metricStackHeightPx);
    paintSyncedMetricStacks(activeSet());
  }
);

metricStackHeightRangeEl.addEventListener("pointerdown", () => {
  if (state.metricStackHeightPx <= 0) setMetricStackHeight(Number(metricStackHeightRangeEl.value) || 560, false);
});
metricStackHeightRangeEl.addEventListener("input", () => {
  setMetricStackHeight(Number(metricStackHeightRangeEl.value));
  paintSyncedMetricStacks(activeSet());
});

let windowResizePaintTimer: number | undefined;
window.addEventListener("resize", () => {
  if (!dataset) return;
  window.clearTimeout(windowResizePaintTimer);
  windowResizePaintTimer = window.setTimeout(() => schedulePaintSyncedMetricStacks(activeSet()), 120);
});

syncMetricStackHeightUi();
showDistReadoutEl.checked = state.showDistReadout;
expandDistReadoutEl.checked = state.distReadoutExpanded;

// No chart until user loads example data or CSV (see welcome screen).
