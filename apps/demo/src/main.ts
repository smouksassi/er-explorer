import {
  fitLogisticModel,
  predictLogisticWaldResult,
  bootstrapLogisticCI,
  summarizeDistribution,
  kernelDensityEstimate,
  silvermanBandwidth,
  quantile,
  createModelDefinition,
  type LogisticModel,
  type PredictionResult,
  projectedSelectionGroups,
  rowsForGroup,
  colorForGroup,
  type SelectionProjectionCtx,
  selectionGroupLabel,
  MIN_FIT_N,
  MIN_SUMMARY_N
} from "@er-explorer/analysis";
import { linearAnalysisModel, type LinearParams } from "@er-explorer/model-linear";
import { fitLoess, predictLoess, predictLoessAt, type LoessFit } from "@er-explorer/model-loess";
import { fitEmax, predictEmax, predictEmaxAt, describeEmaxFit, type EmaxFit } from "@er-explorer/model-emax";
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
import {
  MISSING_LEVEL,
  buildCellResolutionInput,
  setVariableRecodes,
  type VariableRecode,
  enumerateDistPanels,
  enumerateScatterPanels,
  getColumn,
  loadDataset
} from "@er-explorer/data";
import type { DistPanelSpec, ScatterPanelSpec, ViewLayoutSpec } from "@er-explorer/domain";
import {
  DOSE_GROUPING_ID,
  GROUP_KEY_SEPARATOR,
  dedupeFacetDimensions,
  distEndpointColorSplit,
  endpointStripsAreDistinct,
  formatDistGroupId,
  resolveGrouping,
  resolveLinetype,
  isGuidedCompareTopology,
  layoutHasEndpointFacet,
  parseDistGroupId as parseDistGroupRef,
  resolveCellContext,
  resolveDistVisualContext,
  resolveLegendShowsEndpoints,
  resolveOverlayCohortPolicy,
  resolvePanelVisualPolicy,
  type ObservedGroupSummary,
  type OverlayCohortPolicy,
  type ViewSelection
} from "@er-explorer/domain";
import { policyForLayoutChrome } from "./layout/resolvePanelStyle";
import { linearFamily, logisticFamily } from "./endpointFamilies";

/** Observed summaries are endpoint-TYPE driven (user decision 4a): a binary
 * endpoint reports x/N even under a smoother fit. Fitted math keys off the
 * fitted model's own kind instead. */
function observedFamilyFor(endpoint: Endpoint) {
  return isContinuousEndpoint(endpoint) ? linearFamily : logisticFamily;
}
import {
  type ByodSessionPayload,
  buildByodPayload,
  verifySnapshotChecksum
} from "./datasetSnapshot";
import { initAppShell, setPlotWorkspaceVisible, setShellRail } from "./appShell";
import { mountSortableChips, mountSortableFieldList } from "./sortableFieldList";
import {
  type EndpointAnalysisModel,
  type EndpointNormScale,
  dataRangeForEndpoint,
  endpointDataKind,
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
import { defaultAdvancedSpecFromGuided } from "./guidedViewLayout";
import { buildColorBinModel, colorLevelForRow, type ColorBinModel } from "./colorVariableBins";
import { mountViewLayoutGrid } from "./renderViewLayout";
import {
  applyAdvancedSpecToUi,
  applyFacetSelectFromSpec,
  populateFacetSelectOptions,
  readAdvancedSpecFromUi
} from "./advancedLayoutUi";
import { defaultAdvancedLayout, resolveViewLayoutSpec, type LayoutMode } from "./viewLayoutState";

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

/** ADR-0013: one projected-group shape for every model family. The observed
 * summary is produced by the endpoint-TYPE family adapter (x/N Wilson for
 * binary, mean±CI for continuous) — consumers never branch on family. */
interface ProjectedGroup {
  groupId: string | number;
  /** Curve association (I8): matches a curve group's key; "" = pooled; absent on legacy compare paths. */
  curveKey?: string;
  /** Readout label from the pipeline (clicked row, refined by group key). */
  label?: string;
  color: string;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  min?: number;
  max?: number;
  observedSummary?: ObservedGroupSummary;
}

/** One observed marker at exposure x — the family adapter owns the math and
 * labels (ADR-0013); consumers never branch on endpoint type. */
interface ObservedBin {
  x: number;
  summary: ObservedGroupSummary;
  color?: string;
  strokeDash?: string;
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
/** Guided presets (rethink §D.1, H5 — Guided writes the spec; covariates are Advanced-only). */
type GuidedPreset = "endpoint-rows" | "exposure-rows" | "overlay";

/** Overlay preset active with enough endpoints to overlay (guided-mode gate). */
function guidedOverlayActive(endpointCount: number): boolean {
  return state.guidedPreset === "overlay" && endpointCount > 1;
}

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

/**
 * Painter path by DATA KIND, never by the selected model (ADR-0013): loess on a
 * binary endpoint keeps the binary painter (jittered 0/1 points, probability
 * axis, x/N observed) while the curve comes from the chosen family.
 */
function isContinuousEndpoint(endpoint: Endpoint): boolean {
  if (!dataset) return false;
  return endpointDataKind(dataset, endpoint) === "continuous";
}

function endpointModelFor(endpoint: Endpoint): EndpointAnalysisModel {
  if (!dataset) return "logistic";
  return state.endpointModels[endpoint] ?? inferDefaultEndpointModel(dataset, endpoint);
}

/** Per-endpoint loess tuning (user-owned; defaults match R stats::loess). */
function loessSettingsFor(endpoint: Endpoint): { span: number; degree: 1 | 2 } {
  return state.loessSettings[endpoint] ?? { span: 0.75, degree: 2 };
}

/** Per-endpoint Emax toggles (user-owned; default = plain Emax with a
 * baseline anchor: γ fixed at 1, E0 estimated). */
function emaxSettingsFor(endpoint: Endpoint): { estimateGamma: boolean; estimateE0: boolean } {
  return state.emaxSettings[endpoint] ?? { estimateGamma: false, estimateE0: true };
}

function ensureEndpointAnalysisDefaults(): void {
  if (!dataset) return;
  for (const e of endpointOrder()) {
    if (!state.endpointModels[e]) {
      state.endpointModels[e] = inferDefaultEndpointModel(dataset, e);
    }
  }
  for (const e of endpointOrder()) {
    if (isContinuousEndpoint(e)) ensureNormScaleForEndpoint(e);
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
  if (!isContinuousEndpoint(endpoint)) return y;
  const { min, max, valid } = getCompareNormBounds(endpoint);
  if (!valid) return NaN;
  return normToCompareScale(y, min, max);
}

function isPlaceboDose(dose: string): boolean {
  // The list is materialized from the dataset's inferred default on activation,
  // so an EMPTY list is the user's explicit "no reference arm" - never re-infer.
  return state.referenceArmDoses.some((a) => a.toLowerCase() === dose.toLowerCase());
}

/** PK-like exposures: reference arm ~0 on x; non-PK (wt, age): all dose groups on x. */
function exposureIsPkMetric(metric: ExposureMetric): boolean {
  // User-owned override first (mapping UI); auto-detection is only the default.
  const override = state.exposurePkOverrides[metric];
  if (override !== undefined) return override;
  if (looksLikePkExposureColumn(metric)) return true;
  const placeboRows = rowIndicesPlacebo();
  if (!placeboRows.length) return false;
  const vals = placeboRows.map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
  if (!vals.length) return true;
  return Math.max(...vals) <= 1e-6;
}

function exposureXDomain(metric: ExposureMetric, rowIndices?: number[]): [number, number] {
  const indices = rowIndices ?? dataFilteredRowIndices();
  const xs = indices.map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
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
  const ds = requireDataset();
  const levels = ds.doseOrder();
  const selected = new Set(
    state.referenceArmDoses
      .map((t) => levels.find((l) => l.toLowerCase() === t.trim().toLowerCase()))
      .filter((l): l is string => !!l)
  );
  referenceArmLevelsEl.innerHTML = "";
  for (const level of levels) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = level;
    input.checked = selected.has(level);
    input.addEventListener("change", () => {
      state.referenceArmDoses = [...referenceArmLevelsEl.querySelectorAll<HTMLInputElement>("input:checked")].map(
        (i) => i.value
      );
      syncReferenceArmUi();
      syncExposurePkUi();
      render();
    });
    label.append(input, document.createTextNode(" " + level));
    referenceArmLevelsEl.appendChild(label);
  }
  // Legacy free-text / session tokens that match no dose level are surfaced,
  // never silently dropped.
  const unmatched = state.referenceArmDoses.filter(
    (t) => !levels.some((l) => l.toLowerCase() === t.trim().toLowerCase())
  );
  referenceArmWarningEl.hidden = unmatched.length === 0;
  referenceArmWarningEl.textContent = unmatched.length
    ? "Ignored (match no dose level): " + unmatched.join(", ")
    : "";
}

function syncExposurePkUi(): void {
  if (!dataset) {
    exposurePkFieldEl.hidden = true;
    return;
  }
  const ds = requireDataset();
  const metrics = ds.exposureOrder();
  exposurePkFieldEl.hidden = metrics.length === 0;
  exposurePkListEl.innerHTML = "";
  for (const metric of metrics) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = exposureIsPkMetric(metric);
    input.addEventListener("change", () => {
      state.exposurePkOverrides[metric] = input.checked;
      syncExposurePkUi();
      syncColumnRolesSummary();
      render();
    });
    const overridden = state.exposurePkOverrides[metric] !== undefined;
    label.append(
      input,
      document.createTextNode(" " + exposureLabel(metric) + (overridden ? "" : " (auto)"))
    );
    label.title = overridden
      ? "User override - untick/tick to change; reload mapping to return to auto"
      : "Auto-detected; tick/untick to override";
    exposurePkListEl.appendChild(label);
  }
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
  /** Dose labels toggled by clicking distribution rows (shared across panels). */
  selectedDoses: Set<string>;
  /** When distribution rows are split by endpoint (or color level), full group ids e.g. `600 mg|icgi`. */
  selectedDistGroupIds: Set<string>;
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
  /** Show the raw jittered per-patient scatter points on the exposure-vs-response panel(s).
   * Applies to both the regular grid and Compare Endpoints (where points are colored by
   * endpoint instead of dose). On by default in the regular grid; Compare Endpoints has
   * historically kept them off since with several curves already overlaid, raw points add a lot
   * of visual noise - but the toggle now applies uniformly to both views. */
  showPoints: boolean;
  /** Facet grid: endpoints along rows (default) or exposures along rows. */
  guidedPreset: GuidedPreset;
  /** E6 callout density: per-group split/bin callouts follow the selection ("selected") or always render ("all"). */
  calloutDensity: "selected" | "all";
  /** Per-variable level recodes (merge/rename/route-to-missing/order) - data prep, in-place, reversible. */
  variableRecodes: Record<string, VariableRecode>;
  /** Per-exposure PK override (absent = auto-detect by name / zero reference arm). */
  exposurePkOverrides: Record<string, boolean>;
  doseColorScheme: ColorSchemeId;
  endpointColorScheme: ColorSchemeId;
  endpointModels: Record<string, EndpointAnalysisModel>;
  /** Per-endpoint loess span/degree (only read when that endpoint's model is "loess"). */
  loessSettings: Record<string, { span: number; degree: 1 | 2 }>;
  /** Per-endpoint Emax toggles (only read when that endpoint's model is "emax").
   * estimateGamma default false (γ fixed at 1); estimateE0 default true —
   * turn off when there is no placebo/SoC anchor (E0 fixed at 0). */
  emaxSettings: Record<string, { estimateGamma: boolean; estimateE0: boolean }>;
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
  layoutMode: LayoutMode;
  advancedViewLayout: ViewLayoutSpec | null;
}

const state: DemoState = {
  exposureMetrics: new Set(["auc"]),
  endpoints: new Set(["icgi"]),
  ciMethod: "wald",
  bootstrapSeed: 12345,
  bootstrapResamples: 300,
  brushedIds: null,
  selectedDoses: new Set(),
  selectedDistGroupIds: new Set(),
  distributionMode: "boxplot",
  referenceLineKind: null,
  splitAnnotationMode: "off",
  showObservedResponders: false,
  showReferenceFit: false,
  showFittedAtObservedBin: false,
  showSplitValue: false,
  showDoseObserved: true,
  showPoints: true,
  guidedPreset: "endpoint-rows",
  calloutDensity: "selected",
  variableRecodes: {},
  exposurePkOverrides: {},
  doseColorScheme: "default",
  endpointColorScheme: "default",
  endpointModels: {},
  loessSettings: {},
  emaxSettings: {},
  endpointNormScales: {},
  dataFilters: [],
  compareDistByEndpoint: true,
  scatterPaneRatio: loadScatterPaneRatio(),
  metricStackHeightPx: loadMetricStackHeight(),
  showDistReadout: true,
  distReadoutExpanded: false,
  exposureColumnOrder: [],
  endpointColumnOrder: [],
  referenceArmDoses: [],
  layoutMode: "guided",
  advancedViewLayout: null
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
const scatterPanelById = new Map<string, ScatterPanelSpec>();
const distPanelById = new Map<string, DistPanelSpec>();
let activeViewLayoutSpec: ViewLayoutSpec | null = null;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(
      `Demo UI element #${id} not found. Run "node apps/demo/scripts/verify-build.mjs" from the repo root, then open apps/demo/dist/index.html or apps/demo/index.html (requires apps/demo/bundle.js).`
    );
  }
  return el as T;
};
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
const referenceArmLevelsEl = $<HTMLDivElement>("referenceArmLevels");
const referenceArmWarningEl = $<HTMLParagraphElement>("referenceArmWarning");
const exposurePkFieldEl = $<HTMLDivElement>("exposurePkField");
const exposurePkListEl = $<HTMLDivElement>("exposurePkList");
const referenceArmFieldEl = $<HTMLDivElement>("referenceArmField");
const guidedPresetRadios = (): HTMLInputElement[] =>
  [...document.querySelectorAll<HTMLInputElement>('input[name="guidedPreset"]')];
function syncGuidedPresetUi(): void {
  for (const rb of guidedPresetRadios()) rb.checked = rb.value === state.guidedPreset;
}
const doseColorSchemeSelect = $<HTMLSelectElement>("doseColorScheme");
const endpointColorSchemeSelect = $<HTMLSelectElement>("endpointColorScheme");
const endpointModelsListEl = $<HTMLDivElement>("endpointModelsList");
const compareNormSectionEl = $<HTMLDivElement>("compareNormSection");
const compareNormListEl = $<HTMLDivElement>("compareNormList");
const advancedLayoutSectionEl = $<HTMLDivElement>("advancedLayoutSection");
const advancedRowFacetsEl = $<HTMLSelectElement>("advancedRowFacets");
const advancedColFacetsEl = $<HTMLSelectElement>("advancedColFacets");
const advancedColorByEl = $<HTMLSelectElement>("advancedColorBy");
const advancedColorBinningEl = $<HTMLSelectElement>("advancedColorBinning");
const advancedGroupCurvesEl = $<HTMLSelectElement>("advancedGroupCurves");
const advancedLinetypeByEl = $<HTMLSelectElement>("advancedLinetypeBy");
const recodeSectionEl = $<HTMLDivElement>("recodeSection");
const recodeVariableSelectEl = $<HTMLSelectElement>("recodeVariableSelect");
const recodeEditorEl = $<HTMLDivElement>("recodeEditor");
const advancedColorDistShapesEl = $<HTMLInputElement>("advancedColorDistShapes");
const resetAdvancedToGuidedBtn = $<HTMLButtonElement>("resetAdvancedToGuidedBtn");
const advancedLayoutStatusEl = $<HTMLParagraphElement>("advancedLayoutStatus");
const guidedLayoutHintEl = $<HTMLDivElement>("guidedLayoutHint");

function selectedAdvancedFacetVariableIds(): Set<string> {
  const ids = new Set<string>();
  for (const sel of [advancedRowFacetsEl, advancedColFacetsEl]) {
    for (const opt of sel.options) {
      if (!opt.selected || !opt.value.startsWith("var:")) continue;
      ids.add(opt.value.slice(4));
    }
  }
  return ids;
}

function reconcileAdvancedColorWithFacets(): void {
  // ADR-0012: the same variable on facet AND color is legal (degenerate but
  // useful — one level per panel keeps its stable color across facet toggles).
}

function refreshAdvancedColorOptions(): void {
  if (!dataset) return;
  const keep = advancedColorByEl.value;
  advancedColorByEl.innerHTML =
    '<option value="dose">Dose</option><option value="endpoints">Endpoints</option>';
  for (const col of filterColumnOptions()) {
    const opt = document.createElement("option");
    opt.value = col.id;
    opt.textContent = col.label;
    advancedColorByEl.appendChild(opt);
  }
  if ([...advancedColorByEl.options].some((o) => o.value === keep)) advancedColorByEl.value = keep;

  // Group curves by (§J): none, dose, or any covariate — grouping is statistics,
  // independent of what the color channel paints.
  const keepGroup = advancedGroupCurvesEl.value;
  advancedGroupCurvesEl.innerHTML =
    `<option value="">(none — one pooled curve per endpoint)</option><option value="${DOSE_GROUPING_ID}">Dose</option>`;
  for (const col of filterColumnOptions()) {
    const opt = document.createElement("option");
    opt.value = col.id;
    opt.textContent = col.label;
    advancedGroupCurvesEl.appendChild(opt);
  }
  if ([...advancedGroupCurvesEl.options].some((o) => o.value === keepGroup)) {
    advancedGroupCurvesEl.value = keepGroup;
  }

  // Linetype (§H3a, law B): none (default — unmapped paints nothing) |
  // endpoints (identity dash) | any covariate. A second paint channel for
  // curve strokes; mapped = applies unconditionally, no gates.
  const keepLinetype = advancedLinetypeByEl.value;
  advancedLinetypeByEl.innerHTML =
    '<option value="none">(none — all solid)</option><option value="endpoints">Endpoints (identity dash)</option>';
  for (const col of filterColumnOptions()) {
    const opt = document.createElement("option");
    opt.value = col.id;
    opt.textContent = col.label;
    advancedLinetypeByEl.appendChild(opt);
  }
  if ([...advancedLinetypeByEl.options].some((o) => o.value === keepLinetype)) {
    advancedLinetypeByEl.value = keepLinetype;
  }
}

/**
 * ADR-0012 one-color-channel paint for dose-only rows (dist strip rows AND the
 * dose-click projection accent — they must match): the dose palette applies only
 * when color IS dose; a degenerate single-level cell (same variable on facet +
 * color) keeps its level color; any other color encoding renders neutral ink.
 */
function resolveDoseRowPaint(
  spec: ViewLayoutSpec | null,
  scatterPanel: ScatterPanelSpec | undefined,
  /** The mark's endpoint scope when it is WIDER than one cell — a collapsed
   * dist strip serves every endpoint of its scatter panels; constancy must be
   * evaluated over that set, not the first cell's. Absent = the cell itself. */
  stripEndpointIds?: readonly string[]
): { neutral?: boolean; fixedColor?: string } {
  if (!spec) return {};
  if (!scatterPanel) return spec.color.kind !== "dose" ? { neutral: true } : {};
  const ctx = resolveCellContext(
    buildCellResolutionInput(
      requireDataset().loaded,
      spec,
      selectedEndpoints(),
      dataFilteredRowIndices(),
      scatterPanel
    )
  );
  if (ctx.distRows.palette === "neutral") return { neutral: true };
  if (ctx.distRows.palette === "endpoint") {
    // Constancy over the mark's scope: a single-endpoint scope wears the
    // endpoint accent (per-column strips, and the matching projection accent —
    // this module's contract is that the two agree); a wider scope is neutral.
    const scope = stripEndpointIds ?? ctx.endpointIds;
    return scope.length === 1 && ctx.distRows.endpointId
      ? { fixedColor: endpointColor(ctx.distRows.endpointId as Endpoint) }
      : { neutral: true };
  }
  if (
    ctx.distRows.palette === "variable" &&
    !ctx.distRows.splitLevels.length &&
    ctx.colorChannel.kind === "variable" &&
    ctx.colorChannel.levels.length === 1
  ) {
    const paletteModel = colorBinModelForSpec(spec, dataFilteredRowIndices());
    const level = ctx.colorChannel.levels[0]!;
    return {
      fixedColor: variableColorForLevel(ctx.colorChannel.variableId, level, paletteModel?.levels ?? [level])
    };
  }
  return {};
}

function colorBinModelForSpec(spec: ViewLayoutSpec | null | undefined, cohortRowIndices: number[]): ColorBinModel | null {
  if (!spec || spec.color.kind !== "variable" || !dataset) return null;
  const binning = spec.continuousBinning ?? spec.color.binning;
  return buildColorBinModel(dataset.loaded, spec.color.variableId, cohortRowIndices, binning);
}

function refreshAdvancedFacetOptions(): void {
  if (!dataset) return;
  const covariates = filterColumnOptions();
  populateFacetSelectOptions(advancedRowFacetsEl, covariates);
  populateFacetSelectOptions(advancedColFacetsEl, covariates);
  refreshAdvancedColorOptions();
}

function layoutAnalysisContext(): {
  endpointIds: string[];
  endpointOrder: string[];
  xMetricIds: string[];
  xMetricOrder: string[];
} {
  return {
    endpointIds: selectedEndpoints(),
    endpointOrder: endpointOrder(),
    xMetricIds: selectedExposureMetrics(),
    xMetricOrder: exposureOrder()
  };
}

function pullAdvancedSpecFromUi(): ViewLayoutSpec {
  return readAdvancedSpecFromUi(
    selectedEndpoints(),
    selectedExposureMetrics(),
    advancedRowFacetsEl,
    advancedColFacetsEl,
    advancedColorByEl.value,
    advancedColorBinningEl.value,
    advancedGroupCurvesEl.value,
    advancedLinetypeByEl.value,
    advancedColorDistShapesEl.checked
  );
}

function resolveActiveViewLayoutSpec(): ViewLayoutSpec {
  const ctx = layoutAnalysisContext();
  return resolveViewLayoutSpec(state.layoutMode, guidedLayoutInput(), state.advancedViewLayout, ctx);
}

function syncAdvancedFacetSelectsFromSpec(spec: ViewLayoutSpec): void {
  applyFacetSelectFromSpec(advancedRowFacetsEl, spec.rowDimensions);
  applyFacetSelectFromSpec(advancedColFacetsEl, spec.colDimensions);
}

function syncAdvancedColorDistShapesUi(spec: ViewLayoutSpec | null): void {
  if (!spec) {
    advancedColorDistShapesEl.disabled = false;
    return;
  }
  const label = advancedColorDistShapesEl.closest("label");
  if (spec.color.kind === "dose") {
    advancedColorDistShapesEl.disabled = true;
    advancedColorDistShapesEl.checked = false;
    if (label) label.title = "Not used when color is dose (boxplots follow dose palette).";
    return;
  }
  // Endpoints on COLUMNS: each strip already serves exactly one endpoint —
  // nothing to split into (it wears that endpoint's color automatically, via
  // constancy). Endpoints on ROWS still share ONE collapsed strip across
  // several endpoints, so splitting it remains meaningful there — the same
  // law the variable channel already gets with no facet-based exception.
  if (spec.color.kind === "endpoints" && endpointStripsAreDistinct(spec)) {
    advancedColorDistShapesEl.disabled = true;
    advancedColorDistShapesEl.checked = false;
    if (label) {
      label.title = "One endpoint per panel — boxplots use that endpoint’s color automatically. Nothing to split.";
    }
    if (state.layoutMode === "advanced" && state.advancedViewLayout?.distribution.colorDistShapes) {
      state.advancedViewLayout = {
        ...state.advancedViewLayout,
        distribution: { ...state.advancedViewLayout.distribution, colorDistShapes: false }
      };
    }
    return;
  }
  advancedColorDistShapesEl.disabled = false;
  if (label) label.title = "";
  if (spec.color.kind === "endpoints") {
    if (label && !label.querySelector(".field-hint-inline")) {
      // keep default label text from HTML
    }
  }
}

function syncAdvancedFitByColorUi(spec: ViewLayoutSpec | null): void {
  // §J: grouping is statistics, legal with ANY channel — the constancy theorem,
  // not the UI, decides what a group's curve wears. Nothing to disable.
  syncAdvancedColorDistShapesUi(spec);
}

function updateAdvancedLayoutStatus(spec: ViewLayoutSpec | null): void {
  if (state.layoutMode !== "advanced") {
    advancedLayoutStatusEl.textContent = "";
    return;
  }
  const parts: string[] = [];
  if (spec) {
    const deduped = dedupeFacetDimensions(spec);
    if (deduped.rowDimensions.length !== spec.rowDimensions.length) {
      parts.push("A facet dimension was on both rows and columns — kept on columns only.");
    }
    const rowKinds = new Set(spec.rowDimensions.map((d) => (d.kind === "variable" ? d.variableId : d.kind)));
    for (const d of spec.colDimensions) {
      const k = d.kind === "variable" ? d.variableId : d.kind;
      if (rowKinds.has(k)) {
        parts.push(
          `“${d.kind === "variable" ? covariateLabel(d.variableId) : d.kind}” is on both row and column facets — column facet kept.`
        );
      }
    }
    const xOnRow = spec.rowDimensions.some((d) => d.kind === "xMetrics");
    const xOnCol = spec.colDimensions.some((d) => d.kind === "xMetrics");
    if (xOnRow && xOnCol) {
      parts.push("Exposure metrics on both rows and columns — usually put exposure metrics on columns only (x-axis).");
    }
    if (spec.color.kind === "endpoints" && layoutHasEndpointFacet(spec)) {
      parts.push(
        endpointStripsAreDistinct(spec)
          ? "Endpoints are faceted on columns — curves/points AND that column's boxplot strip use its own endpoint color automatically."
          : "Endpoints are faceted on rows — curves/points use each panel's endpoint color; the shared boxplot strip stays neutral unless you turn on \"Color-split boxplots\"."
      );
    }
    const endpoints = selectedEndpoints();
    const metrics = selectedExposureMetrics();
    if (endpoints.length && metrics.length && dataset?.loaded) {
      const scatter = enumerateScatterPanels(
        dataset.loaded,
        [],
        deduped,
        { xMetricIds: metrics, endpointIds: endpoints },
        dataFilteredRowIndices()
      );
      parts.push(`Grid: ${scatter.length} scatter panel(s).`);
    }
  }
  if (!parts.length) {
    parts.push(
      "Exposure metrics on columns = one column per exposure (x-axis). Endpoints on row or column = separate panel per endpoint. Color: Endpoints (without endpoint facets) = multiple curves per panel."
    );
  }
  advancedLayoutStatusEl.textContent = parts.join(" ");
}

function syncLayoutModeUi(options?: { refreshAdvancedControls?: boolean }): void {
  const advanced = state.layoutMode === "advanced";
  advancedLayoutSectionEl.hidden = !advanced;
  guidedLayoutHintEl.hidden = advanced;
  for (const rb of guidedPresetRadios()) rb.disabled = advanced;
  if (advanced) {
    if (options?.refreshAdvancedControls) {
      refreshAdvancedFacetOptions();
      const spec =
        state.advancedViewLayout ??
        defaultAdvancedLayout(
          selectedEndpoints(),
          endpointOrder(),
          selectedExposureMetrics(),
          exposureOrder()
        );
      applyAdvancedSpecToUi(
        spec,
        advancedRowFacetsEl,
        advancedColFacetsEl,
        advancedColorByEl,
        advancedColorBinningEl,
        advancedGroupCurvesEl,
        advancedLinetypeByEl,
        advancedColorDistShapesEl
      );
    }
    syncAdvancedFitByColorUi(state.advancedViewLayout ?? activeViewLayoutSpec);
    updateAdvancedLayoutStatus(state.advancedViewLayout ?? activeViewLayoutSpec);
  } else {
    advancedLayoutStatusEl.textContent = "";
  }
  document.querySelectorAll<HTMLInputElement>('input[name="layoutMode"]').forEach((rb) => {
    rb.checked = rb.value === state.layoutMode;
  });
}

function covariateLabel(variableId: string): string {
  return filterColumnOptions().find((c) => c.id === variableId)?.label ?? variableId;
}

function facetDimensionValueLabel(
  dim: import("@er-explorer/domain").LayoutDimension,
  panel: ScatterPanelSpec,
  facetKey: ScatterPanelSpec["facetKey"]
): string {
  const ds = requireDataset();
  if (dim.kind === "endpoints") return ds.endpointLabel(panel.endpointId);
  if (dim.kind === "xMetrics") return exposureLabel(panel.xVariableId);
  const raw = facetKey[dim.variableId];
  const name = covariateLabel(dim.variableId);
  return raw != null && String(raw).length ? `${name}: ${raw}` : name;
}

function columnTitleForPanel(panel: ScatterPanelSpec, spec: ViewLayoutSpec): string {
  if (!spec.colDimensions.length) {
    return exposureLabel(panel.xVariableId);
  }
  return spec.colDimensions.map((dim) => facetDimensionValueLabel(dim, panel, panel.facetKey)).join(" · ");
}

function rowStripLabelForPanels(panels: ScatterPanelSpec[], spec: ViewLayoutSpec): string {
  if (!panels.length) return "";
  const panel = panels[0]!;
  if (!spec.rowDimensions.length) return "";
  return spec.rowDimensions.map((dim) => facetDimensionValueLabel(dim, panel, panel.facetKey)).join(" · ");
}

function appendLegendTitle(container: HTMLElement, title: string): void {
  const el = document.createElement("div");
  el.className = "legend-title";
  el.textContent = title;
  container.appendChild(el);
}

/** Linetype legend row (E5): dash sample per level when linetype maps a variable. */
function appendLinetypeLegend(spec: ViewLayoutSpec): void {
  const lt = linetypeAccessFor(spec);
  if (lt.kind !== "variable" || !lt.legend || !lt.variableId) return;
  appendLegendTitle(legendEl, `Linetype · ${covariateLabel(lt.variableId)}`);
  for (const { level, dash } of lt.legend) {
    const item = document.createElement("div");
    item.className = "dotKey";
    item.innerHTML = `<svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke="currentColor" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}></line></svg> ${escapeHtml(level)}`;
    legendEl.appendChild(item);
  }
}

function renderLayoutColorLegend(spec: ViewLayoutSpec): void {
  const ds = requireDataset();
  legendEl.innerHTML = "";
  if (spec.color.kind === "dose") {
    appendLegendTitle(legendEl, "Dose");
    for (const dose of DOSE_ORDER()) {
      const item = document.createElement("div");
      item.className = "dotKey";
      item.innerHTML = `<span class="swatch" style="background:${resolveDoseColor(dose)}"></span> ${escapeHtml(dose)}`;
      legendEl.appendChild(item);
    }
    appendLinetypeLegend(spec);
    return;
  }
  if (spec.color.kind === "endpoints") {
    appendLegendTitle(legendEl, "Endpoint");
    for (const endpoint of selectedEndpoints()) {
      const item = document.createElement("div");
      item.className = "dotKey";
      item.innerHTML = `<span class="swatch" style="background:${endpointColor(endpoint)}"></span> ${escapeHtml(ds.endpointLabel(endpoint))}`;
      legendEl.appendChild(item);
    }
    appendLinetypeLegend(spec);
    return;
  }
  const variableId = spec.color.variableId;
  appendLegendTitle(legendEl, covariateLabel(variableId));
  const model = colorBinModelForSpec(spec, dataFilteredRowIndices());
  const levels = model?.levels ?? distinctVariableLevels(variableId, dataFilteredRowIndices());
  for (const level of levels) {
    const item = document.createElement("div");
    item.className = "dotKey";
    item.innerHTML = `<span class="swatch" style="background:${variableColorForLevel(variableId, level, levels)}"></span> ${escapeHtml(level)}`;
    legendEl.appendChild(item);
  }
  appendLinetypeLegend(spec);
}

function renderVariableColorLegend(variableId: string): void {
  renderLayoutColorLegend({ mode: "advanced", rowDimensions: [], colDimensions: [], color: { kind: "variable", variableId }, grouping: { variableIds: [] }, distribution: { linkage: "shared_by_x_column", colorDistShapes: false } });
}

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
    state.guidedPreset === "exposure-rows" ? Math.max(1, endpoints.length) : Math.max(1, metrics.length);
  return Math.max(480, Math.floor(1200 / cols));
}

/** A fitted model for one metric/endpoint pair, tagged by which family produced it - "logistic"
 * for the existing binary responder endpoints (ICGI/ICGI2/ICGI3), "linear" (the
 * @er-explorer/model-linear plugin) for the continuous rating-scale endpoints (BRLS/PRLS). Both
 * `LogisticModel` and `LinearParams` expose `intercept`/`slope`, so most call sites only need to
 * branch on `kind` where the two families' meaning actually diverges (the response scale, and
 * whether a fitted value needs a sigmoid transform). */
type EndpointFit =
  | { kind: "logistic"; model: LogisticModel }
  | { kind: "linear"; model: LinearParams }
  | { kind: "loess"; model: LoessFit }
  | { kind: "emax"; model: EmaxFit };

function fitFor(metric: ExposureMetric, endpoint: Endpoint): { fit: EndpointFit; xs: number[]; ys: number[] } {
  return fitForCohort(metric, endpoint, recordsWithEndpoint(endpoint));
}

function fitForCohort(
  metric: ExposureMetric,
  endpoint: Endpoint,
  cohortRowIndices: number[]
): { fit: EndpointFit; xs: number[]; ys: number[] } {
  const indices = cohortRowIndices.filter((i) => Number.isFinite(endpointValue(i, endpoint)));
  const xs = indices.map((i) => exposureValue(i, metric));
  const ys = indices.map((i) => endpointValue(i, endpoint));
  // The FAMILY decides the curve; the painter path is data-kind driven
  // elsewhere (ADR-0013 — no pipeline branching on family beyond this seam).
  const family = endpointModelFor(endpoint);
  if (family === "loess") {
    const model = fitLoess(xs, ys, loessSettingsFor(endpoint));
    if (!model) throw new Error(`Too few points for loess (${metric}/${endpoint})`);
    return { fit: { kind: "loess", model }, xs, ys };
  }
  // Emax is continuous-endpoints-only (parked for binary — see
  // .ai/CONTINUE_HERE.md); a stale session's "emax" on a now-binary endpoint
  // falls through to logistic rather than attempting continuous math on it.
  if (family === "emax" && isContinuousEndpoint(endpoint)) {
    const model = fitEmax(xs, ys, emaxSettingsFor(endpoint));
    if (!model) throw new Error(`Too few points/doses for Emax (${metric}/${endpoint})`);
    return { fit: { kind: "emax", model }, xs, ys };
  }
  if (family === "linear") {
    const outcome = linearAnalysisModel.fit({ exposures: xs, responses: ys });
    if (!outcome.optimization.converged) throw new Error(`Unable to fit linear model for ${metric}/${endpoint}`);
    return { fit: { kind: "linear", model: outcome.params }, xs, ys };
  }
  const model = fitLogisticModel(xs, ys);
  if (!model) throw new Error(`Unable to fit logistic model for ${metric}/${endpoint}`);
  return { fit: { kind: "logistic", model }, xs, ys };
}

/** Reserved missing-level ink: gray, never a palette slot — missingness must not
 * read as a data category (rule, QA round 12). */
const MISSING_LEVEL_COLOR = "#9ca3af";

function variableColorForLevel(variableId: string, level: string, levels: string[]): string {
  if (level === MISSING_LEVEL) return MISSING_LEVEL_COLOR;
  const idx = levels.indexOf(level);
  const palette = COLOR_SCHEME_PALETTES.tableau;
  return palette[(idx >= 0 ? idx : 0) % palette.length]!;
}

function distinctVariableLevels(variableId: string, rowIndices: number[]): string[] {
  const loaded = requireDataset().loaded;
  const set = new Set<string>();
  for (const i of rowIndices) {
    const raw = getColumn(loaded, variableId)[i];
    if (raw === null || raw === undefined) continue;
    set.add(String(raw).trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function variableColorPaletteLevels(colorVarId: string, cohortRowIndices?: number[]): string[] {
  return distinctVariableLevels(colorVarId, cohortRowIndices ?? dataFilteredRowIndices());
}

function endpointIdForDistPanel(panelId: string | undefined, fallback: Endpoint): Endpoint {
  if (panelId) {
    const dp = distPanelById.get(panelId);
    if (dp?.readoutEndpointId) return dp.readoutEndpointId as Endpoint;
    const sp = scatterPanelById.get(panelId);
    if (sp?.facetKey.endpoint) return sp.facetKey.endpoint as Endpoint;
    if (sp?.endpointId) return sp.endpointId as Endpoint;
  }
  return fallback;
}

function cohortForPanel(panelId?: string): number[] | undefined {
  if (!panelId) return undefined;
  return scatterPanelById.get(panelId)?.rowIndices;
}

function panelMatchesEndpointForOverlay(panel: ScatterPanelSpec, endpoint: Endpoint): boolean {
  if (panel.facetKey.endpoint === endpoint) return true;
  if (panel.endpointId === endpoint) return true;
  if (panel.endpointIds?.includes(endpoint)) return true;
  return false;
}

/** ADR-0011: exposure split cut points use endpoint × metric, not facet/color slices. */
function rowIndicesForReferenceSplit(metric: ExposureMetric, endpoint: Endpoint): number[] {
  const allowed = new Set(dataFilteredRowIndices());
  const merged = new Set<number>();
  for (const p of scatterPanelById.values()) {
    if (p.xVariableId === metric && panelMatchesEndpointForOverlay(p, endpoint)) {
      for (const i of p.rowIndices) if (allowed.has(i)) merged.add(i);
    }
  }
  if (!merged.size) {
    return recordsWithEndpoint(endpoint).filter((i) => allowed.has(i));
  }
  return [...merged];
}

function overlayPolicyForScatterPanel(
  panelId: string | undefined,
  endpoint: Endpoint
): OverlayCohortPolicy | null {
  const spec = resolveActiveViewLayoutSpec();
  if (!spec) return null;
  const panel = panelId ? scatterPanelById.get(panelId) : undefined;
  if (panel) return resolveOverlayCohortPolicy(spec, panel, selectedEndpoints());
  return resolveOverlayCohortPolicy(spec, { facetKey: {}, endpointId: endpoint }, selectedEndpoints());
}

/** Shared exposure x-axis domain for scatter + distribution in the same exposure column (all facet rows). */
function xDomainForLinkedPanels(metric: ExposureMetric, panelId?: string): [number, number] {
  const xMetric =
    (panelId && scatterPanelById.get(panelId)?.xVariableId) ||
    (panelId && distPanelById.get(panelId)?.xVariableId) ||
    metric;

  const merged = new Set<number>();
  for (const p of scatterPanelById.values()) {
    if (p.xVariableId === xMetric) p.rowIndices.forEach((i) => merged.add(i));
  }
  for (const d of distPanelById.values()) {
    if (d.xVariableId === xMetric) {
      d.rowIndices.forEach((i) => merged.add(i));
      for (const sid of d.scatterPanelIds) {
        scatterPanelById.get(sid)?.rowIndices.forEach((i) => merged.add(i));
      }
    }
  }

  if (!merged.size && panelId) {
    scatterPanelById.get(panelId)?.rowIndices.forEach((i) => merged.add(i));
    const dist = distPanelById.get(panelId);
    if (dist) {
      dist.rowIndices.forEach((i) => merged.add(i));
      for (const sid of dist.scatterPanelIds) {
        scatterPanelById.get(sid)?.rowIndices.forEach((i) => merged.add(i));
      }
    }
  }

  const indices = merged.size ? [...merged] : dataFilteredRowIndices();
  return exposureXDomain(metric, indices);
}

function tryFitForCohort(
  metric: ExposureMetric,
  endpoint: Endpoint,
  cohortRowIndices: number[]
): { fit: EndpointFit; xs: number[]; ys: number[] } | null {
  const indices = cohortRowIndices.filter((i) => Number.isFinite(endpointValue(i, endpoint)));
  // Unified minimum-support rule (I11): no family fits below MIN_FIT_N — the
  // raw points stay on screen and the readout says "fit n/a (N=k)". A cohort
  // whose exposure support is a single value (placebo) still fits and renders
  // as the P1 degenerate point marker, never a line.
  if (indices.length < MIN_FIT_N) return null;
  try {
    return fitForCohort(metric, endpoint, indices);
  } catch {
    return null;
  }
}

function distSplitByEndpointActive(splitByEndpoints?: Endpoint[]): boolean {
  if (!splitByEndpoints || splitByEndpoints.length <= 1) return false;
  const spec = resolveActiveViewLayoutSpec();
  if (!spec) return state.layoutMode === "guided" && state.compareDistByEndpoint;
  const ctx = resolveDistVisualContext(
    spec,
    { compareEndpointIds: splitByEndpoints, fallbackEndpointId: splitByEndpoints[0]! },
    selectedEndpoints()
  );
  return ctx.splitByEndpointIds.length > 1;
}

function layoutUsesNeutralDoseChrome(): boolean {
  const chrome = policyForLayoutChrome(activeViewLayoutSpec ?? resolveActiveViewLayoutSpec(), selectedEndpoints());
  if (chrome) return chrome.useNeutralDoseLabelsInChrome;
  return guidedOverlayActive(selectedEndpoints().length);
}

function selectedDosesForEndpoint(endpoint: Endpoint): Set<string> {
  if (!state.selectedDistGroupIds.size) return state.selectedDoses;
  const endpointIds = new Set(selectedEndpoints());
  const out = new Set<string>();
  for (const gid of state.selectedDistGroupIds) {
    const sep = gid.indexOf("|");
    if (sep === -1) continue;
    const dose = gid.slice(0, sep);
    const suffix = gid.slice(sep + 1);
    if (endpointIds.has(suffix as Endpoint)) {
      if (suffix === endpoint) out.add(dose);
    } else {
      out.add(dose);
    }
  }
  return out;
}

/** Dose labels currently selected via distribution rows (plain dose or `dose|level` splits). */
function parseDistGroupId(gid: string): { dose: string; suffix?: string } {
  const sep = gid.indexOf("|");
  if (sep === -1) return { dose: gid };
  return { dose: gid.slice(0, sep), suffix: gid.slice(sep + 1) };
}

/** Dist row ids to project (plain dose or `dose|endpoint` / `dose|colorLevel`). */
/**
 * E1 (ADR-0013): the selection → projection pipeline lives in
 * `@er-explorer/analysis` (selectionProjection.ts) — ONE implementation for
 * every family, unit-testable without the DOM. The demo builds the injected
 * context from its dataset/state closures; the wrappers below preserve the
 * historical call-site signatures.
 */
function baseColorModelFor(spec: ViewLayoutSpec | null): ColorBinModel | null {
  // Bin model on the BASE cohort (I1) — never a panel/branch/selection cohort.
  return spec?.color.kind === "variable" && dataset
    ? buildColorBinModel(
        dataset.loaded,
        spec.color.variableId,
        dataFilteredRowIndices(),
        spec.continuousBinning ?? spec.color.binning
      )
    : null;
}

/**
 * Base-cohort accessors for the DECLARED grouping (§J): ordered composite keys
 * (curve granularity, I8) and a per-row key. Level models are built with the
 * same binning as the color channel would use, so grouping-by-the-color-variable
 * shares its cuts exactly.
 */
function groupingAccessFor(spec: ViewLayoutSpec | null): {
  keys: string[];
  keyForRow: (rowIndex: number) => string | null;
} {
  const ids = resolveGrouping(spec);
  if (!ids.length || !dataset) return { keys: [], keyForRow: () => null };
  const ds = requireDataset();
  const base = dataFilteredRowIndices();
  const parts: Array<{ levels: string[]; forRow: (i: number) => string | null }> = [];
  for (const vid of ids) {
    if (vid === DOSE_GROUPING_ID) {
      parts.push({ levels: DOSE_ORDER(), forRow: (i) => ds.doseLabel(i) || null });
    } else {
      const binning =
        (spec?.color.kind === "variable" && spec.color.variableId === vid ? spec.color.binning : undefined) ??
        spec?.continuousBinning;
      const model = buildColorBinModel(ds.loaded, vid, base, binning);
      parts.push({
        levels: model.levels,
        forRow: (i) => colorLevelForRow(i, model, ds.loaded, vid) || null
      });
    }
  }
  let keys: string[] = [""];
  for (const p of parts) {
    keys = keys.flatMap((k) => p.levels.map((l) => (k ? `${k}${GROUP_KEY_SEPARATOR}${l}` : l)));
  }
  const keyForRow = (i: number): string | null => {
    let key = "";
    for (const p of parts) {
      const v = p.forRow(i);
      if (v === null) return null;
      key = key ? `${key}${GROUP_KEY_SEPARATOR}${v}` : v;
    }
    return key;
  };
  return { keys, keyForRow };
}

/** "" unless `valueOf` yields one identical non-null value across all rows (constancy theorem). */
function constantOver(rows: number[], valueOf: (rowIndex: number) => string | null): string {
  let seen: string | null = null;
  for (const i of rows) {
    const v = valueOf(i);
    if (v === null || v === undefined || v === "") return "";
    if (seen === null) seen = v;
    else if (seen !== v) return "";
  }
  return seen ?? "";
}

/**
 * Linetype channel (§H3a / E5): a SECOND paint channel for CURVE STROKES only.
 * Same constancy law as color — a curve wears a dash iff the linetype variable
 * is constant within its group's rows. Points, strips, and observed markers
 * never dash. Default (endpoints): dash disambiguates shared ink — multi-
 * endpoint cells and the endpoints color channel; single-endpoint cells solid
 * (exactly the legacy behavior).
 */
function linetypeAccessFor(spec: ViewLayoutSpec | null): {
  kind: "none" | "endpoints" | "variable";
  variableId?: string;
  dashForRows: (rows: number[], endpoint: Endpoint) => string;
  legend?: Array<{ level: string; dash: string }>;
} {
  const lt = resolveLinetype(spec);
  if (!spec || lt.kind === "none" || !dataset) return { kind: "none", dashForRows: () => "" };
  if (lt.kind === "endpoints") {
    // Law B: a mapped channel applies UNCONDITIONALLY. Endpoints are an
    // identity scale — an endpoint wears its dash everywhere it appears (alone,
    // faceted, overlaid), exactly as it wears its identity color. The old
    // cell-count / color=endpoints gates were the special cases exterminated
    // 2026-09-17 (user ruling: "no gating, no special cases").
    return {
      kind: "endpoints",
      dashForRows: (_rows, endpoint) => endpointDash(endpoint)
    };
  }
  const ds = requireDataset();
  const binning =
    (spec.color.kind === "variable" && spec.color.variableId === lt.variableId
      ? spec.color.binning
      : lt.binning) ?? spec.continuousBinning;
  // Level model on the BASE cohort — dash↔level assignment must be identical in
  // every panel (same rule as color and grouping models).
  const model = buildColorBinModel(ds.loaded, lt.variableId, dataFilteredRowIndices(), binning);
  const dashForLevel = (level: string): string => {
    const idx = model.levels.indexOf(level);
    return ENDPOINT_DASH_PATTERNS[(idx >= 0 ? idx : 0) % ENDPOINT_DASH_PATTERNS.length]!;
  };
  return {
    kind: "variable",
    variableId: lt.variableId,
    dashForRows: (rows) => {
      const level = constantOver(rows, (i) => colorLevelForRow(i, model, ds.loaded, lt.variableId) || null);
      return level ? dashForLevel(level) : "";
    },
    legend: model.levels.map((level) => ({ level, dash: dashForLevel(level) }))
  };
}

/**
 * E6 callout density (rethink §J.6): the plot is an extraction tool — split/bin
 * callouts follow the SELECTION by default. Returns "all" (render every
 * group's callouts: density "all", or a pooled dose row is selected — I8
 * expands it to every group), null (no selection: cohort-level callouts only),
 * or the set of selected channel levels.
 */
function calloutLevelFilter(): "all" | null | Set<string> {
  if (state.calloutDensity === "all") return "all";
  if (!state.selectedDistGroupIds.size && !state.selectedDoses.size) return null;
  if (state.selectedDoses.size) return "all";
  const levels = new Set<string>();
  for (const gid of state.selectedDistGroupIds) {
    const { suffix } = parseDistGroupId(gid);
    if (suffix && !selectedEndpoints().includes(suffix as Endpoint)) levels.add(suffix);
    else return "all";
  }
  return levels;
}

/** Fitted-at-split/bin markers under the density rule: a curve shows its pill
 * iff it hosts a projection of the current selection (the I8 association); with
 * no selection, only a lone pooled curve gets one. */
function curveShowsFitCallout(hostsProjection: boolean, curveCount: number): boolean {
  const filter = calloutLevelFilter();
  if (filter === "all") return true;
  if (filter === null) return curveCount === 1;
  return hostsProjection;
}

function selectionProjectionCtxFor(
  active: Set<number>,
  spec: ViewLayoutSpec | null,
  colorModel: ColorBinModel | null,
  metric?: ExposureMetric
): SelectionProjectionCtx {
  const ds = requireDataset();
  const colorVarId = spec?.color.kind === "variable" ? spec.color.variableId : null;
  const grouping = groupingAccessFor(spec);
  return {
    spec,
    groupingKeys: grouping.keys,
    groupingKeyForRow: grouping.keyForRow,
    doseForRow: (i) => ds.doseLabel(i) || null,
    knownEndpointIds: selectedEndpoints(),
    selectedDistGroupIds: state.selectedDistGroupIds,
    selectedDoses: state.selectedDoses,
    showObservedSummary: state.showDoseObserved,
    colorModel,
    rowIndicesForDose,
    isActiveRow: (i) => active.has(ds.patientId(i)),
    exposureValue: (i) => (metric ? exposureValue(i, metric) : NaN),
    endpointValue: (i, ep) => endpointValue(i, ep as Endpoint),
    levelForRow: (i) =>
      colorVarId && colorModel ? colorLevelForRow(i, colorModel, ds.loaded, colorVarId) || null : null,
    summarizeExposures: (vals) => summarizeDistribution(vals),
    colorForLevel: (level) =>
      colorVarId && colorModel
        ? variableColorForLevel(colorVarId, level, colorModel.levels)
        : DOSE_SELECTION_NEUTRAL,
    colorForEndpoint: (ep) => endpointColor(ep as Endpoint),
    colorForDose: (dose) => resolveDoseColor(dose),
    neutralColor: DOSE_SELECTION_NEUTRAL
  };
}

function projectedGroupsForDistSelection(
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  cohortRowIndices?: number[],
  opts?: { colorOverride?: string; spec?: ViewLayoutSpec | null }
): ProjectedGroup[] {
  const spec = opts?.spec ?? resolveActiveViewLayoutSpec();
  const colorModel = baseColorModelFor(spec ?? null);
  const ctx = selectionProjectionCtxFor(active, spec ?? null, colorModel, metric);
  return projectedSelectionGroups(
    ctx,
    endpoint,
    observedFamilyFor(endpoint),
    cohortRowIndices,
    opts?.colorOverride
  );
}


function rowsForDistGroupId(
  gid: string,
  active: Set<number>,
  cohortRowIndices: number[] | undefined,
  endpoint: Endpoint,
  colorContext?: { variableId: string; model: ColorBinModel }
): number[] {
  const spec = resolveActiveViewLayoutSpec();
  const ctx = selectionProjectionCtxFor(active, spec ?? null, colorContext?.model ?? baseColorModelFor(spec ?? null));
  return rowsForGroup(ctx, gid, endpoint, cohortRowIndices);
}

function colorForDistGroupId(
  gid: string,
  _endpoint: Endpoint,
  spec: ViewLayoutSpec | null,
  colorModel: ColorBinModel | null,
  rows: number[],
  colorOverride?: string
): string {
  const ctx = selectionProjectionCtxFor(activeSet(), spec, colorModel);
  return colorForGroup(ctx, gid, rows, colorOverride);
}

function pointColorsMonochromeForEndpoint(endpoint: Endpoint): Record<string, string> {
  const c = endpointColor(endpoint);
  const map: Record<string, string> = {};
  for (const dose of DOSE_ORDER()) map[dose] = c;
  return map;
}

function curveFor(fit: EndpointFit, xs: number[], ys: number[], xDomain: [number, number]): PredictionResult {
  // No extrapolation (same rule as KDE, user ruling): a curve is drawn only
  // over its OWN fit cohort's observed exposure support. A per-arm curve stops
  // at that arm's min/max; a single-exposure group (placebo — all AUC 0)
  // degenerates to ONE sample, which painters render as a fitted point + CI
  // whisker instead of a full-width line.
  let xMin = xDomain[0];
  let xMax = xDomain[1];
  if (xs.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of xs) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo <= hi) {
      xMin = Math.max(xMin, lo);
      xMax = Math.min(xMax, hi);
    }
  }
  const span = xMax - xMin;
  const dense =
    span > 0 ? Array.from({ length: 121 }, (_, i) => xMin + (span * i) / 120) : [xMin];
  if (fit.kind === "loess") {
    // t-based pointwise band (predict se + t multiplier — the ggquickeda
    // recipe, H4b); bootstrap for loess is future work, so both CI settings
    // draw the same band. Never clamped (round-2 §I.4).
    const preds = predictLoess(fit.model, dense);
    if (state.ciMethod === "none") {
      return { estimates: preds.map((e) => ({ ...e, lower: NaN, upper: NaN })), metadata: {} };
    }
    return { estimates: preds, metadata: {} };
  }
  if (fit.kind === "emax") {
    // Delta-method (Gauss-Newton) pointwise band — the ggquickeda-adjacent
    // recipe, same shape as loess's H4b band. Bootstrap for Emax is future
    // work (like loess), so both CI settings draw the same band for now.
    const preds = predictEmax(fit.model, dense);
    if (state.ciMethod === "none") {
      return { estimates: preds.map((e) => ({ ...e, lower: NaN, upper: NaN })), metadata: {} };
    }
    // Fresh literal copy: PredictionResult.estimates is Array<Record<string, number>>,
    // which (per TS) a NAMED interface like EmaxPrediction doesn't structurally
    // satisfy without one — loess's inline-literal return type gets this for free.
    return { estimates: preds.map((e) => ({ ...e })), metadata: {} };
  }
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

/**
 * Universal equation + parameter-estimate description, one branch per
 * `EndpointFit.kind` — the same "switch on fit.kind" pattern `curveFor`/
 * `fitAt` already use. Every family describes itself; this is a leaf DISPLAY
 * concern (the readout tooltip and the Endpoint Models line), not a pipeline
 * seam, so ADR-0013's "adapter only" contract is unaffected — a family that
 * skips this switch simply shows no equation, no wiring elsewhere breaks.
 */
function describeFit(fit: EndpointFit): {
  equation: string;
  params: Array<{ label: string; value: number; se?: number }>;
  /** Universal slot (currently only Emax populates it): a family may flag
   * that a parameter is poorly identified rather than presenting it as an
   * ordinary point estimate. */
  warning?: string;
} {
  if (fit.kind === "emax") return describeEmaxFit(fit.model);
  if (fit.kind === "loess") {
    const m = fit.model;
    return {
      equation: `local weighted regression (span ${m.span}, degree ${m.degree})`,
      params: [
        { label: "enp (effective params)", value: m.enp },
        { label: "σ (residual)", value: m.sigma }
      ]
    };
  }
  const seFrom = (cov: { b00: number; b01: number; b11: number } | null): [number | undefined, number | undefined] =>
    cov ? [Math.sqrt(Math.max(cov.b00, 0)), Math.sqrt(Math.max(cov.b11, 0))] : [undefined, undefined];
  if (fit.kind === "linear") {
    const [seIntercept, seSlope] = seFrom(fit.model.covariance);
    return {
      equation: "y = a + b·x",
      params: [
        { label: "a (intercept)", value: fit.model.intercept, se: seIntercept },
        { label: "b (slope)", value: fit.model.slope, se: seSlope }
      ]
    };
  }
  const [seIntercept, seSlope] = seFrom(fit.model.covariance);
  return {
    equation: "logit(p) = a + b·x",
    params: [
      { label: "a (intercept)", value: fit.model.intercept, se: seIntercept },
      { label: "b (slope)", value: fit.model.slope, se: seSlope }
    ]
  };
}

/** Plain-text rendering of {@link describeFit} for a `title` tooltip attribute. */
function describeFitTooltip(fit: EndpointFit): string {
  const { equation, params, warning } = describeFit(fit);
  const lines = params.map((p) => `${p.label} = ${p.value.toFixed(3)}${p.se !== undefined ? ` (SE ${p.se.toFixed(3)})` : ""}`);
  return [equation, ...lines, ...(warning ? [warning] : [])].join("\n");
}

/** Two-line fit callout: estimate, then optional bracketed CI (no "Fit" prefix — color encodes split vs bin). */
function formatFitMarkerLines(estimate: number, lower: number, upper: number, decimals: number): [string, string] {
  const line1 = estimate.toFixed(decimals);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return [line1, ""];
  return [line1, `[${lower.toFixed(decimals)}-${upper.toFixed(decimals)}]`];
}

/**
 * No-extrapolation rule: a single-exposure curve group (placebo — every AUC 0)
 * has no exposure span, so there is no line to draw; it renders as ONE fitted
 * point + CI whisker at its exposure, in the curve's own color.
 */
function degenerateFitMarkerLayer(
  id: string,
  samples: CurveSample[],
  color: string,
  decimals: number,
  xAxisLabel: string
): RendererLayer | null {
  if (samples.length !== 1) return null;
  const s = samples[0]!;
  const lower = Number.isFinite(s.lower) ? s.lower : s.estimate;
  const upper = Number.isFinite(s.upper) ? s.upper : s.estimate;
  const [l1, l2] = formatFitMarkerLines(s.estimate, lower, upper, decimals);
  return new ObservedStatLayer({
    id,
    bins: [
      {
        x: s.exposure,
        center: s.estimate,
        lower,
        upper,
        n: 0,
        primaryLabel: l1,
        secondaryLabel: l2 || `@ ${formatExposureForReadout(s.exposure)}`,
        color,
        tooltip: `Fitted at ${xAxisLabel} = ${formatExposureForReadout(s.exposure)}\nSingle-exposure group — no curve drawn (no extrapolation beyond the group's data)`
      }
    ]
  });
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
  const chrome = policyForLayoutChrome(activeViewLayoutSpec ?? resolveActiveViewLayoutSpec(), selectedEndpoints());
  return chrome?.useNeutralDistShapes ?? false;
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
  const spec = resolveActiveViewLayoutSpec();
  const compareRaw = stack.dataset.compareEndpoints;
  if (compareRaw) {
    const eps = compareRaw.split("|").filter(Boolean) as Endpoint[];
    if (eps.length === 1) {
      // Per-column strip (P1): the readout fits ONLY this column's endpoint —
      // never the whole selected list.
      return {
        endpoint: eps[0]!,
        splitByEndpoints: undefined,
        readoutEndpoints: eps,
        omitEndpointFit: false
      };
    }
    if (eps.length > 1) {
      if (spec) {
        const ctx = resolveDistVisualContext(
          spec,
          { compareEndpointIds: eps, fallbackEndpointId: eps[0]! },
          selectedEndpoints()
        );
        const split =
          ctx.splitByEndpointIds.length > 1 ? (ctx.splitByEndpointIds as Endpoint[]) : undefined;
        return {
          endpoint: eps[0]!,
          splitByEndpoints: split,
          readoutEndpoints: ctx.readoutEndpointIds as Endpoint[],
          omitEndpointFit: ctx.omitPerEndpointFitInReadout
        };
      }
      const split = distSplitByEndpointActive(eps);
      return {
        endpoint: eps[0]!,
        splitByEndpoints: split ? eps : undefined,
        readoutEndpoints: split ? eps : [eps[0]!],
        omitEndpointFit: !split
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

/**
 * Effective scatter/dist split for one facet: `state.scatterPaneRatio` is the
 * PER-STRIP ratio; a facet stacking N row-faceted dist grids gets N strips'
 * worth of dist share (capped so scatter keeps ≥40%) — one strip's share split
 * N ways made the charts bleed under the following grids (QA 2026-08-24).
 */
function effectiveScatterRatioFor(facet: HTMLElement): number {
  const n = Number(facet.dataset.distGridCount ?? "1") || 1;
  if (n <= 1) return state.scatterPaneRatio;
  const distShare = Math.min(0.6, (1 - state.scatterPaneRatio) * n);
  return 1 - distShare;
}

function applyAllMetricStackHeights(): void {
  document.querySelectorAll<HTMLElement>(".facet-layout").forEach((facet) => {
    applyMetricStackHeight(facet, state.metricStackHeightPx);
    applyScatterPaneRatio(facet, effectiveScatterRatioFor(facet));
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
      // The user drags the EFFECTIVE split; store it back per-strip so the
      // multi-grid scaling in effectiveScatterRatioFor does not double-apply.
      const n = Number(facet.dataset.distGridCount ?? "1") || 1;
      state.scatterPaneRatio = n <= 1 ? ratio : 1 - (1 - ratio) / n;
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
  // Observe the CHART boxes too, not just the shells: an expanded readout (or
  // any other in-cell reflow) changes a chart's box after paint without moving
  // the stack's outer size — the pinned SVG then meet-scales and its x-axis
  // desyncs from its neighbors until something repaints. One corrective repaint
  // converges (paint reproduces the same sizes, so the observer goes quiet).
  document
    .querySelectorAll(".facet-layout, .metric-stack, .metric-stack .chart")
    .forEach((el) => metricStackResizeObserver!.observe(el));
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

/**
 * Selection invariant (ADR-0012 / ViewSelection C1): a selection may only
 * reference dist rows that exist in the CURRENT layout. Rendered ids are
 * collected during each paint pass; anything orphaned by a layout change is
 * pruned afterwards (one guarded re-render), so stale rows can no longer
 * project ghost bands with no visible row to unselect.
 */
const renderedDistGroupIds = new Set<string>();
const renderedDistDoseRows = new Set<string>();
let selectionPruneRerenderScheduled = false;

function registerRenderedDistGroups(groups: DistributionRawGroup[]): void {
  for (const g of groups) {
    const gid = String(g.groupId);
    renderedDistGroupIds.add(gid);
    const sep = gid.indexOf("|");
    renderedDistDoseRows.add(sep === -1 ? gid : gid.slice(0, sep));
  }
}

function pruneOrphanedSelection(): void {
  if (!state.selectedDistGroupIds.size && !state.selectedDoses.size) return;
  let dropped = false;
  for (const gid of [...state.selectedDistGroupIds]) {
    if (!renderedDistGroupIds.has(gid)) {
      state.selectedDistGroupIds.delete(gid);
      dropped = true;
    }
  }
  for (const dose of [...state.selectedDoses]) {
    if (!renderedDistDoseRows.has(dose)) {
      state.selectedDoses.delete(dose);
      dropped = true;
    }
  }
  if (dropped && !selectionPruneRerenderScheduled) {
    selectionPruneRerenderScheduled = true;
    requestAnimationFrame(() => {
      selectionPruneRerenderScheduled = false;
      render();
    });
  }
}

function paintSyncedMetricStacks(active: Set<number>): void {
  if (!dataset) return;
  // NOTE: renderedDistGroupIds is cleared in render() (mount), not here — dist
  // cells paint both at mount and in this synced pass depending on layout; a
  // pass that repaints no dist stacks must not empty the registry, or the prune
  // below would wipe a selection the user just made.
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
      paintRegularScatterIntoWrap(
        scatterWrap,
        metric,
        endpoint,
        active,
        width,
        scatterH,
        stack.dataset.panelId
      );
      pinChartSvgToContainer(scatterWrap, width, scatterH);
      return;
    }

    if (kind === "scatter-compare") {
      const endpoints = (stack.dataset.compareEndpoints ?? "")
        .split("|")
        .filter(Boolean) as Endpoint[];
      if (!endpoints.length || !scatterWrap) return;
      paintCompareScatterIntoWrap(scatterWrap, metric, endpoints, active, width, scatterH, stack.dataset.panelId);
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
        { showReadout: true, omitEndpointFit: ctx.omitEndpointFit, panelId: stack.dataset.panelId }
      );
      return;
    }
  });
  pruneOrphanedSelection();
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
  // null = the panel abstains from a pooled curve (below minimum fit support);
  // points, observed markers, and reference lines still render.
  curve: PredictionResult | null,
  projected: ProjectedGroup[],
  xDomain: [number, number],
  metric: ExposureMetric,
  endpoint: Endpoint,
  width: number,
  referenceLines: ReferenceLine[],
  observedBins: ObservedBin[],
  height = SCATTER_CHART_HEIGHT,
  opts?: {
    /** §J curve groups (one per grouping partition); replaces the single pooled curve. */
    curves?: Array<{ curve: PredictionResult; color: string; dash?: string; key?: string }>;
    /** Point color under the active color channel; default = dose palette. */
    pointColorFor?: (p: ScatterPoint) => string;
  }
): { content: string; metadata: ScatterMeta } {
  const ds = requireDataset();
  const curveOverlays = opts?.curves?.length
    ? opts.curves.map((c) => ({
        samples: toCurveSamples(c.curve),
        color: c.color,
        band: c.color,
        dash: c.dash,
        key: c.key
      }))
    : curve
      ? [
          {
            samples: toCurveSamples(curve),
            color: "#64748b",
            band: "#94a3b8",
            dash: undefined as string | undefined,
            key: undefined as string | undefined
          }
        ]
      : [];
  const allSamples = curveOverlays.flatMap((c) => c.samples);
  // I8, no fallbacks: a projected group rides ONLY its own curve, matched
  // structurally by curveKey (the pipeline always sets it; "" = pooled). A
  // group whose fit abstained has no curve and therefore NO projection
  // geometry — its raw points still highlight and the readout still speaks.
  // (The old suffix/dose/first-curve fallback let an uncurved group ride a
  // FOREIGN group's curve on continuous panels only — probe-caught 2026-09-03.)
  const samplesForGroup = (p: Pick<ProjectedGroup, "curveKey">): CurveSample[] =>
    curveOverlays.find((c) => (c.key ?? "") === (p.curveKey ?? ""))?.samples ?? [];
  const yDomain = computeContinuousYDomain(points, allSamples);
  const plotHeight = height;

  const scatterPoints: ScatterPointDatum[] = (state.showPoints ? points : []).map((p) =>
    scatterDatumFromPoint(p, {
      color: opts?.pointColorFor?.(p) ?? resolveDoseColor(String(p.groupId)) ?? "#64748b",
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
    })
  ];
  curveOverlays.forEach((c, ci) => {
    const pointMarker = degenerateFitMarkerLayer(`curve-point-${ci}`, c.samples, c.color, 1, exposureLabel(metric));
    if (pointMarker) {
      layers.push(pointMarker);
      return;
    }
    layers.push(new ConfidenceRibbonLayer({ id: `band-${ci}`, samples: c.samples, color: c.band, opacity: 0.18 }));
    // Dash verbatim from the linetype authority ("" = solid). The former
    // `|| undefined` coercion re-routed "solid" into FitLayer's legacy dashed
    // default — the binary/continuous family asymmetry (2026-09 linetype bug).
    layers.push(new FitLayer({ id: `curve-${ci}`, samples: c.samples, color: c.color, dash: c.dash }));
  });

  // One law for EVERYTHING a projection draws (markers, bands, observed pill):
  // no curve to ride — nothing renders. Matches the binary painter, which
  // attaches projections per curve and never sees orphans.
  const ridableProjected = projected.filter((p) => samplesForGroup(p).length >= 2);

  if (ridableProjected.length) {
    const rangeSamplesFor = (p: ProjectedGroup) => {
      const lo = p.min ?? p.whiskerLow;
      const hi = p.max ?? p.whiskerHigh;
      return samplesForGroup(p).filter((s) => s.exposure >= lo && s.exposure <= hi);
    };
    const coreSamplesFor = (p: ProjectedGroup) =>
      samplesForGroup(p).filter((s) => s.exposure >= p.q1 && s.exposure <= p.q3);

    ridableProjected.forEach((p, i) => {
      layers.push(new ConfidenceRibbonLayer({ id: `proj-band-${i}`, samples: rangeSamplesFor(p), color: p.color, opacity: 0.1 }));
      layers.push(new FitLayer({ id: `proj-range-${i}`, samples: rangeSamplesFor(p), color: p.color, dash: null, strokeWidth: 1.8, opacity: 0.48 }));
      layers.push(new FitLayer({ id: `proj-core-${i}`, samples: coreSamplesFor(p), color: p.color, dash: null, strokeWidth: 3.8, opacity: 0.98 }));
    });

    ridableProjected.forEach((p, i) => {
      layers.push(
        new DoseProjectionLayer({
          id: `projection-markers-${i}`,
          curveSamples: samplesForGroup(p),
          groups: [{ color: p.color, q1: p.q1, q3: p.q3, median: p.median, min: p.min, max: p.max }]
        })
      );
    });

    // ADR-0013: labels come from the family adapter's summary — no family
    // branching here. Capital N = the clicked group's own observed count.
    const observedStats = ridableProjected
      .filter((p): p is ProjectedGroup & { observedSummary: ObservedGroupSummary } => Boolean(p.observedSummary))
      .map((p) => ({
        x: p.median,
        center: p.observedSummary.center,
        lower: p.observedSummary.lower,
        upper: p.observedSummary.upper,
        n: p.observedSummary.n,
        primaryLabel: p.observedSummary.primaryLabel,
        secondaryLabel: `N=${p.observedSummary.n} · @ ${formatExposureForReadout(p.median)}`,
        color: p.color,
        tooltip: observedMarkerTooltip(
          exposureLabel(metric),
          p.median,
          `Observed ${p.observedSummary.primaryLabel} (${p.observedSummary.secondaryLabel})`,
          `95% CI · N=${p.observedSummary.n}`
        )
      }));
    if (observedStats.length) layers.push(new ObservedStatLayer({ id: "projection-observed", bins: observedStats }));
  }

  if (referenceLines.length) {
    const multiCurve = curveOverlays.length > 1;
    const projectionHostKeys = new Set(ridableProjected.map((p) => p.curveKey ?? ""));
    const markerOverlays = curveOverlays.filter((c) =>
      curveShowsFitCallout(projectionHostKeys.has(c.key ?? ""), curveOverlays.length)
    );
    const refSpecs: ReferenceLineSpec[] = referenceLines.map((ref) => {
      const spec: ReferenceLineSpec = { value: ref.value, label: ref.label };
      if (state.showSplitValue) spec.valueLabel = ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1);
      if (state.showReferenceFit) {
        // One fitted marker per curve group: same split x, per-group y (ADR-0012;
        // E6 density decides WHICH groups' markers render).
        spec.markerValues = markerOverlays.map((c) => {
          const at = interpolateCurveSample(c.samples, ref.value);
          const [l1, l2] = formatFitMarkerLines(at.estimate, at.lower, at.upper, 1);
          return {
            estimate: at.estimate,
            lower: at.lower,
            upper: at.upper,
            lines: [l1, l2],
            color: multiCurve ? c.color : "#94a3b8",
            tooltip: splitFitMarkerTooltip(exposureLabel(metric), ref.value)
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
        id: "observed-mean-bins",
        bins: observedBins.map((b) => ({
          x: b.x,
          center: b.summary.center,
          lower: b.summary.lower,
          upper: b.summary.upper,
          n: b.summary.n,
          primaryLabel: b.summary.primaryLabel,
          secondaryLabel: `n=${b.summary.n} · @ ${formatExposureForReadout(b.x)}`,
          color: b.color,
          tooltip: observedMarkerTooltip(
            exposureLabel(metric),
            b.x,
            `Observed ${b.summary.primaryLabel}`,
            `95% CI · N=${b.summary.n}`
          )
        }))
      })
    );
  }

  if (state.showFittedAtObservedBin && observedBins.length) {
    const hostKeys = new Set(ridableProjected.map((p) => p.curveKey ?? ""));
    curveOverlays.forEach((c, ci) => {
      if (!curveShowsFitCallout(hostKeys.has(c.key ?? ""), curveOverlays.length)) return;
      layers.push(
        createFitAtObservedBinLayer(
          `fit-at-observed-bin-${ci}`,
          observedBins.map((b) => b.x),
          c.samples,
          exposureLabel(metric),
          1
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
  observedBins: ObservedBin[],
  height = SCATTER_CHART_HEIGHT
): { content: string; metadata: ScatterMeta } {
  const plotHeight = height;
  const hasExtras = curves.length > 1;
  const curveSamplesFor = curves.map((c) => toCurveSamples(c.curve));
  // Never clamp a smoother (round-2 §I.4): pad the probability axis to cover
  // any curve/band overflow from loess-on-binary instead of pinning it.
  let yLo = -0.18;
  let yHi = 1.18;
  for (const samples of curveSamplesFor) {
    for (const s of samples) {
      const lo = Number.isFinite(s.lower) ? Math.min(s.lower, s.estimate) : s.estimate;
      const hi = Number.isFinite(s.upper) ? Math.max(s.upper, s.estimate) : s.estimate;
      if (Number.isFinite(lo)) yLo = Math.min(yLo, lo - 0.02);
      if (Number.isFinite(hi)) yHi = Math.max(yHi, hi + 0.02);
    }
  }
  const yDomain: [number, number] = [yLo, yHi];

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
    const pointMarker = degenerateFitMarkerLayer(
      `curve-point-${i}`,
      samples,
      c.color ?? "#0f172a",
      c.fitLabelDecimals ?? 2,
      xAxisLabel
    );
    if (pointMarker) {
      layers.push(pointMarker);
    } else {
      layers.push(new ConfidenceRibbonLayer({ id: `band-${i}`, samples, color: c.color, opacity: i === 0 ? 0.18 : 0.14 }));
      layers.push(new FitLayer({ id: `curve-${i}`, samples, color: c.color, dash: c.dash }));
    }

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

    // ADR-0013: ONE observed block for every family — values, CI, and labels come
    // from the adapter's summary (x/N Wilson, mean±CI, later P(Y≥k)). The former
    // binary/continuous twin blocks branched on shape; consumers no longer may.
    const observedStats = projected
      .filter((p): p is ProjectedGroup & { observedSummary: ObservedGroupSummary } => Boolean(p.observedSummary))
      .map((p) => ({
        x: p.median,
        center: p.observedSummary.center,
        lower: p.observedSummary.lower,
        upper: p.observedSummary.upper,
        n: p.observedSummary.n,
        primaryLabel: p.observedSummary.primaryLabel,
        secondaryLabel: `${p.observedSummary.secondaryLabel} · @ ${formatExposureForReadout(p.median)}`,
        color: p.color,
        tooltip: observedMarkerTooltip(
          xAxisLabel,
          p.median,
          `Observed ${p.observedSummary.primaryLabel} (${p.observedSummary.secondaryLabel})`,
          `95% CI · N=${p.observedSummary.n}`
        )
      }));
    if (observedStats.length) layers.push(new ObservedStatLayer({ id: `projection-observed-${i}`, bins: observedStats }));
  });

  if (referenceLines.length) {
    const markerCurveIdx = curves
      .map((c, ci) => ci)
      .filter((ci) => curveShowsFitCallout((curves[ci]!.projected?.length ?? 0) > 0, curves.length));
    const refSpecs: ReferenceLineSpec[] = referenceLines.map((ref) => {
      const spec: ReferenceLineSpec = { value: ref.value, label: ref.label };
      if (state.showSplitValue) spec.valueLabel = ref.value >= 100 ? ref.value.toFixed(0) : ref.value.toFixed(1);
      if (state.showReferenceFit) {
        spec.markerValues = markerCurveIdx.map((ci) => {
          const c = curves[ci]!;
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
        bins: observedBins.map((b) => ({
          x: b.x,
          center: b.summary.center,
          lower: b.summary.lower,
          upper: b.summary.upper,
          n: b.summary.n,
          primaryLabel: b.summary.primaryLabel,
          secondaryLabel: `${b.summary.secondaryLabel} · @ ${formatExposureForReadout(b.x)}`,
          color: b.color,
          strokeDash: b.strokeDash,
          tooltip: observedMarkerTooltip(
            xAxisLabel,
            b.x,
            `Observed ${b.summary.primaryLabel} (${b.summary.secondaryLabel})`,
            `95% CI · N=${b.summary.n} · mean ${xAxisLabel} in bin`
          )
        }))
      })
    );
  }

  if (state.showFittedAtObservedBin && observedBins.length) {
    curves.forEach((c, ci) => {
      if (!curveShowsFitCallout((c.projected?.length ?? 0) > 0, curves.length)) return;
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
function computeReferenceLines(metric: ExposureMetric, endpoint: Endpoint): ReferenceLine[] {
  const ds = requireDataset();
  const kind = state.referenceLineKind;
  if (!kind) return [];
  const pkLike = exposureIsPkMetric(metric);
  const values = rowIndicesForReferenceSplit(metric, endpoint)
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
 * `computeSplitAnnotations`/`computeObservedBins`/`computeObservedBins` - Min/Max
 * would be meaningless (and would silently double-count bins) there, but are exactly what a
 * caller building a chart's `referenceLines` prop wants.
 */
function computeDisplayReferenceLines(
  metric: ExposureMetric,
  endpoint: Endpoint,
  panelCohortRowIndices?: number[]
): ReferenceLine[] {
  const ds = requireDataset();
  const splits = computeReferenceLines(metric, endpoint);
  if (!splits.length) return splits;
  const cohort = panelCohortRowIndices ?? dataFilteredRowIndices();
  const pkLike = exposureIsPkMetric(metric);
  const values = cohort
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
function computeSplitAnnotations(
  metric: ExposureMetric,
  endpoint: Endpoint,
  xDomain: [number, number],
  mode: SplitAnnotationMode,
  rowIndices: number[]
): DistributionSplitAnnotation[] {
  const cutpoints = computeReferenceLines(metric, endpoint).map((r) => r.value);
  if (!cutpoints.length || !rowIndices.length) return [];
  const vals = rowIndices.map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
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
    const label = mode === "n_pct" ? `n=${counts[i]} (${pct}%)` : `n=${counts[i]}`;
    out.push({ x: (lower + upper) / 2, label });
  }
  return out;
}

function splitAnnotationsForRows(
  metric: ExposureMetric,
  endpoint: Endpoint,
  xDomain: [number, number],
  mode: SplitAnnotationMode,
  rowIndices: number[],
  skip: boolean
): DistributionSplitAnnotation[] | undefined {
  if (skip || mode === "off" || !rowIndices.length) return undefined;
  const ann = computeSplitAnnotations(metric, endpoint, xDomain, mode, rowIndices);
  return ann.length ? ann : undefined;
}

function rowIndicesDosed(): number[] {
  return dataFilteredRowIndices().filter((i) => !isPlaceboDose(requireDataset().doseLabel(i)));
}

function rowIndicesPlacebo(): number[] {
  return dataFilteredRowIndices().filter((i) => isPlaceboDose(requireDataset().doseLabel(i)));
}

/**
 * Observed markers per exposure-split bin, for EVERY family (ADR-0013): the
 * adapter owns the summary math. Rows are endpoint-finite under one rule — the
 * old binary computor bucketed endpoint-missing rows into denominators
 * (missing ≠ non-responder), diverging from its continuous twin.
 */
function computeObservedBins(
  metric: ExposureMetric,
  endpoint: Endpoint,
  cohortRowIndices?: number[]
): ObservedBin[] {
  const ds = requireDataset();
  if (!state.showObservedResponders || !state.referenceLineKind) return [];
  const cutpoints = computeReferenceLines(metric, endpoint).map((r) => r.value);
  if (!cutpoints.length) return [];

  const cohort = cohortRowIndices ?? dataFilteredRowIndices();
  const cohortSet = new Set(cohort);
  const family = observedFamilyFor(endpoint);
  const withEndpoint = recordsWithEndpoint(endpoint).filter((i) => cohortSet.has(i));

  const bins: ObservedBin[] = [];
  const buckets: number[][] = Array.from({ length: cutpoints.length + 1 }, () => []);
  const pushBin = (rows: number[], xOverride?: number) => {
    if (!rows.length) return;
    const summary = family.observedSummary(rows.map((i) => endpointValue(i, endpoint)));
    if (!summary) return;
    const x = xOverride ?? rows.reduce((sum, i) => sum + exposureValue(i, metric), 0) / rows.length;
    bins.push({ x, summary });
  };

  let binnable = withEndpoint;
  if (exposureIsPkMetric(metric)) {
    pushBin(withEndpoint.filter((i) => isPlaceboDose(ds.doseLabel(i))), 0);
    binnable = withEndpoint.filter((i) => !isPlaceboDose(ds.doseLabel(i)));
  }
  binnable.forEach((i) => {
    const v = exposureValue(i, metric);
    if (!Number.isFinite(v)) return;
    let bin = 0;
    while (bin < cutpoints.length && v > cutpoints[bin]) bin++;
    buckets[bin]!.push(i);
  });
  buckets.forEach((rows) => pushBin(rows));
  return bins;
}

/** Per-color-level observed bins when the overlay policy scopes observed markers
 * to color levels within the panel; family-agnostic (ADR-0013). Levels iterate in
 * canonical model order (I1). */
function computeObservedBinsForPanel(
  metric: ExposureMetric,
  endpoint: Endpoint,
  cohortRowIndices: number[],
  overlayPolicy: OverlayCohortPolicy | null,
  colorVarId?: string,
  colorModel?: ReturnType<typeof colorBinModelForSpec>
): ObservedBin[] {
  if (overlayPolicy?.observedAtSplit === "colorLevelWithinPanel" && colorVarId && colorModel) {
    // E6 density: per-level callouts follow the selection; no selection →
    // cohort-level (pooled) callouts only.
    const filter = calloutLevelFilter();
    if (filter === null) return computeObservedBins(metric, endpoint, cohortRowIndices);
    const ds = requireDataset();
    const paletteLevels = colorModel.levels;
    const levels = paletteLevels.filter(
      (level) =>
        (filter === "all" || filter.has(level)) &&
        cohortRowIndices.some((i) => colorLevelForRow(i, colorModel, ds.loaded, colorVarId) === level)
    );
    return levels.flatMap((level) =>
      computeObservedBins(
        metric,
        endpoint,
        cohortRowIndices.filter((i) => colorLevelForRow(i, colorModel, ds.loaded, colorVarId) === level)
      ).map((b) => ({ ...b, color: variableColorForLevel(colorVarId, level, paletteLevels) }))
    );
  }
  return computeObservedBins(metric, endpoint, cohortRowIndices);
}

/** The active patient set is shared across every exposure panel: a brush made in one panel's
 * coordinate space still resolves to patient ids, which highlight the same patients everywhere. */
function activeSet(): Set<number> {
  const ds = requireDataset();
  let ids = new Set(dataFilteredRowIndices().map((i) => ds.patientId(i)));
  if (state.brushedIds) ids = new Set([...ids].filter((id) => state.brushedIds!.has(id)));
  if (state.selectedDistGroupIds.size) {
    const doses = new Set<string>();
    for (const gid of state.selectedDistGroupIds) {
      doses.add(gid.includes("|") ? gid.split("|")[0]! : gid);
    }
    ids = new Set(
      [...ids].filter((id) => {
        const dose = doseForPatientId(id);
        return dose !== undefined && doses.has(dose);
      })
    );
  } else if (state.selectedDoses.size) {
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

function guidedLayoutInput(): import("./guidedViewLayout").GuidedLayoutInput {
  return {
    preset: state.guidedPreset,
    compareDistByEndpoint: state.compareDistByEndpoint,
    exposureMetricIds: selectedExposureMetrics(),
    exposureColumnOrder: state.exposureColumnOrder,
    endpointIds: selectedEndpoints(),
    endpointColumnOrder: state.endpointColumnOrder
  };
}

function renderViewLayoutFacetGrid(metrics: ExposureMetric[], endpoints: Endpoint[]): void {
  const ds = requireDataset();
  const spec = resolveActiveViewLayoutSpec();
  scatterPanelById.clear();
  distPanelById.clear();

  const scatterPanels = enumerateScatterPanels(
    ds.loaded,
    [],
    spec,
    { xMetricIds: metrics, endpointIds: endpoints },
    dataFilteredRowIndices()
  );
  for (const p of scatterPanels) scatterPanelById.set(p.id, p);

  const readoutEp = endpoints[0] ?? scatterPanels[0]?.endpointId ?? "";
  const distSplitEps =
    endpoints.length > 1 &&
    (isGuidedCompareTopology(spec) || distEndpointColorSplit(spec, endpoints.length))
      ? endpoints
      : undefined;
  const distPanels = enumerateDistPanels(
    spec,
    scatterPanels,
    readoutEp,
    distSplitEps,
    endpoints.length
  );
  for (const p of distPanels) distPanelById.set(p.id, p);

  mountViewLayoutGrid(scatterPanelsEl, spec, scatterPanels, distPanels, {
    escapeHtml,
    rowStripLabel: (panels) => rowStripLabelForPanels(panels, spec),
    createFacetLayoutShell,
    attachFacetLayoutSplitter,
    appendScatterCell: (grid, panel) =>
      panel.endpointIds && panel.endpointIds.length > 1
        ? appendComparePanelCell(grid, panel)
        : appendScatterPanelCell(grid, panel),
    appendDistCell: (grid, panel) => appendDistPanelCell(grid, panel),
    onDistGridsMounted: (facet, gridCount) => {
      // Vertically repeated strips (row-faceted dist grids): record the count so
      // effectiveScatterRatioFor gives the dist block one strip's share PER grid.
      facet.dataset.distGridCount = String(gridCount);
      applyScatterPaneRatio(facet, effectiveScatterRatioFor(facet));
    }
  });
}

function appendScatterPanelCell(grid: HTMLElement, panel: ScatterPanelSpec): void {
  const spec = activeViewLayoutSpec;
  const cell = document.createElement("div");
  cell.className = "panel-cell panel-cell-scatter";
  const title = document.createElement("div");
  title.className = "panel-cell-title";
  title.textContent = spec ? columnTitleForPanel(panel, spec) : exposureLabel(panel.xVariableId);
  cell.appendChild(title);
  const stack = document.createElement("div");
  stack.className = "metric-stack metric-stack-scatter-only";
  stack.dataset.stackKind = "scatter-only";
  stack.dataset.metric = panel.xVariableId;
  stack.dataset.endpoint = panel.endpointId;
  stack.dataset.panelId = panel.id;

  const scatterPane = document.createElement("div");
  scatterPane.className = "metric-stack-scatter";
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart";
  chartWrap.dataset.metric = panel.xVariableId;
  scatterPane.appendChild(chartWrap);
  stack.appendChild(scatterPane);
  cell.appendChild(stack);
  grid.appendChild(cell);
}

function appendComparePanelCell(grid: HTMLElement, panel: ScatterPanelSpec): void {
  const endpoints = panel.endpointIds ?? [];
  const spec = activeViewLayoutSpec;
  const cell = document.createElement("div");
  cell.className = "panel-cell panel-cell-scatter";
  const title = document.createElement("div");
  title.className = "panel-cell-title";
  title.textContent = spec ? columnTitleForPanel(panel, spec) : exposureLabel(panel.xVariableId);
  cell.appendChild(title);
  const stack = document.createElement("div");
  stack.className = "metric-stack metric-stack-scatter-only";
  stack.dataset.stackKind = endpoints.length > 1 ? "scatter-compare" : "scatter-only";
  stack.dataset.metric = panel.xVariableId;
  stack.dataset.compareEndpoints = endpoints.join("|");
  stack.dataset.panelId = panel.id;

  const scatterPane = document.createElement("div");
  scatterPane.className = "metric-stack-scatter";
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart";
  chartWrap.dataset.metric = panel.xVariableId;
  scatterPane.appendChild(chartWrap);
  stack.appendChild(scatterPane);
  cell.appendChild(stack);
  grid.appendChild(cell);
}

function appendDistPanelCell(grid: HTMLElement, panel: DistPanelSpec): void {
  const spec = activeViewLayoutSpec;
  const cell = document.createElement("div");
  cell.className = "panel-cell panel-cell-dist";
  const title = document.createElement("div");
  title.className = "panel-cell-title";
  // Title from the dist panel's OWN facet key: the strip collapses over
  // endpoints (ADR-0012 dedup), so naming the first linked scatter panel's
  // endpoint would claim an endpoint the strip does not belong to.
  if (spec) {
    const parts = spec.colDimensions
      .map((dim) => {
        if (dim.kind === "xMetrics") return exposureLabel(panel.xVariableId);
        if (dim.kind === "endpoints") {
          // Strip rule P1 (E3): endpoint COLUMNS carry per-column strips — name
          // the column so the strip and its readout read as that column's.
          const ep = panel.facetKey.endpoint;
          return ep ? requireDataset().endpointLabel(ep as Endpoint) : "";
        }
        const raw = panel.facetKey[dim.variableId];
        const name = covariateLabel(dim.variableId);
        return raw != null && String(raw).length ? `${name}: ${raw}` : name;
      })
      .filter(Boolean);
    title.textContent = parts.length ? parts.join(" · ") : exposureLabel(panel.xVariableId);
  } else {
    title.textContent = exposureLabel(panel.xVariableId);
  }
  cell.appendChild(title);
  const stack = document.createElement("div");
  stack.className = "metric-stack metric-stack-dist-only";
  stack.dataset.stackKind = "dist-only";
  stack.dataset.metric = panel.xVariableId;
  stack.dataset.endpoint = panel.readoutEndpointId;
  stack.dataset.panelId = panel.id;
  if (panel.readoutEndpointIds?.length) {
    stack.dataset.compareEndpoints = panel.readoutEndpointIds.join("|");
  }

  const distPane = document.createElement("div");
  distPane.className = "metric-stack-dist";
  stack.appendChild(distPane);
  cell.appendChild(stack);
  grid.appendChild(cell);
  ensureDistShell(distPane, { showReadout: true });
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

  activeViewLayoutSpec = resolveActiveViewLayoutSpec();
  if (state.layoutMode === "advanced") {
    state.advancedViewLayout = activeViewLayoutSpec;
    syncAdvancedFacetSelectsFromSpec(activeViewLayoutSpec);
  }

  resetMetricStackObservers();
  scatterPanelsEl.innerHTML = "";
  distributionPanels = [];
  // Selection registry lifetime = one mounted layout: cleared here, populated by
  // every dist paint (mount-time AND synced passes), pruned after synced passes.
  renderedDistGroupIds.clear();
  renderedDistDoseRows.clear();

  // "Compare endpoints" overlays every selected endpoint's curve on the same response axis, so
  // it's only meaningful when they all share the same scale - either every selected endpoint is
  // a binary responder outcome (probability axis) or every one is a continuous rating scale
  // (though even then, two different continuous endpoints, e.g. BRLS and PRLS, generally sit on
  // different scales - this restriction just avoids ever mixing a [0,1] probability curve with a
  // rating-scale curve in the same panel). Any number of exposure metrics is fine - each gets its
  // own overlaid "(all)" column.
  const comparisonEligible = endpoints.length > 1;
  const overlayRadio = guidedPresetRadios().find((rb) => rb.value === "overlay");
  if (overlayRadio) {
    overlayRadio.disabled = state.layoutMode === "advanced" || !comparisonEligible;
  }

  const compareHasLinear =
    guidedOverlayActive(endpoints.length) && endpoints.some((e) => isContinuousEndpoint(e));
  syncCompareNormUi(endpoints, compareHasLinear);
  syncCompareDistUi(comparisonEligible);

  const showEndpointLegend =
    comparisonEligible &&
    (activeViewLayoutSpec
      ? resolveLegendShowsEndpoints(activeViewLayoutSpec, endpoints)
      : state.guidedPreset === "overlay");

  if (showEndpointLegend) {
    renderEndpointLegend(endpoints);
    endpointLegendEl.style.display = "flex";
    legendEl.style.display = "none";
    legendEl.innerHTML = "";
  } else if (state.layoutMode === "advanced" && activeViewLayoutSpec) {
    renderLayoutColorLegend(activeViewLayoutSpec);
    legendEl.style.display = "flex";
    endpointLegendEl.style.display = "none";
    endpointLegendEl.innerHTML = "";
  } else {
    legendEl.style.display = "flex";
    endpointLegendEl.style.display = "none";
    renderLegend();
  }
  renderViewLayoutFacetGrid(metrics, endpoints);
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
  syncLayoutModeUi();
}

/**
 * §J curve units, shared by EVERY scatter painter (regular and compare cells):
 * partitions of an endpoint-finite cohort by the declared grouping — one pooled
 * partition when none is declared.
 */
function curvePartitionsForRows(
  spec: ViewLayoutSpec | null,
  recordRows: number[]
): Array<{ key: string; rows: number[] }> {
  const grouping = groupingAccessFor(spec);
  return grouping.keys.length
    ? grouping.keys
        .map((key) => ({ key, rows: recordRows.filter((i) => grouping.keyForRow(i) === key) }))
        .filter((p) => p.rows.length > 0)
    : [{ key: "", rows: recordRows }];
}

/** I8: a projected group rides only its own curve — structural curveKey match. */
function projectedForCurveKey(projected: ProjectedGroup[], key: string): ProjectedGroup[] {
  return projected.filter((g) => (g.curveKey ?? "") === key);
}

function paintRegularScatterIntoWrap(
  chartWrap: HTMLDivElement,
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  width: number,
  height: number,
  panelId?: string
): void {
  const ds = requireDataset();
  const spec = resolveActiveViewLayoutSpec();
  const cohort = cohortForPanel(panelId) ?? dataFilteredRowIndices();
  const recordRows = cohort.filter((i) => Number.isFinite(endpointValue(i, endpoint)));
  const xDomain = xDomainForLinkedPanels(metric, panelId);
  const continuous = isContinuousEndpoint(endpoint);
  const overlayPolicy = overlayPolicyForScatterPanel(panelId, endpoint);
  const colorSpec = spec?.color;
  const colorVarId = colorSpec?.kind === "variable" ? colorSpec.variableId : undefined;
  const panel = panelId ? scatterPanelById.get(panelId) : undefined;
  const scatterPolicy =
    spec && panel
      ? resolvePanelVisualPolicy(spec, panel, selectedEndpoints())
      : spec
        ? resolvePanelVisualPolicy(
            spec,
            { facetKey: panel?.facetKey ?? {}, endpointId: endpoint },
            selectedEndpoints()
          )
        : null;
  // ADR-0012: color stays active when the color variable is also faceted —
  // the panel is single-level and keeps that level's color (stable identity).
  const colorByVariable =
    scatterPolicy?.scatterPointColorSource === "variable" ||
    (!scatterPolicy && state.layoutMode === "advanced" && !!colorVarId);
  // Bin model on the BASE cohort (ADR-0012): binning a numeric covariate inside a
  // facet slice would re-split the panel by its OWN median — a single-level panel
  // (facet+color on the same variable) would fabricate two levels and two curves.
  const colorModel = colorByVariable ? colorBinModelForSpec(spec, dataFilteredRowIndices()) : null;

  const points: ScatterPoint[] = recordRows.map((i) => {
    const pid = ds.patientId(i);
    let groupId: string | number = ds.doseLabel(i);
    if (colorByVariable && colorVarId && colorModel) {
      groupId = colorLevelForRow(i, colorModel, ds.loaded, colorVarId);
    } else if (colorByVariable && colorVarId) {
      groupId = String(getColumn(ds.loaded, colorVarId)[i] ?? "").trim();
    }
    return {
      id: pid,
      exposure: exposureValue(i, metric),
      response: endpointValue(i, endpoint),
      displayY: continuous ? endpointValue(i, endpoint) : endpointValue(i, endpoint) + seededJitter(pid),
      groupId,
      label: scatterPointHoverLabel(i, metric, endpoint),
      selected: active.has(pid)
    };
  });

  let scatterResult: { content: string; metadata: unknown };

  // §J: curve units = partitions of the endpoint-finite cohort by the DECLARED
  // grouping (one pooled partition when none). Each curve wears the channel
  // encoding per the constancy theorem — the channel variable must be constant
  // within the group's rows; otherwise neutral ink. One law for every channel
  // (this subsumes the old fitByColor branches AND the degenerate facet+color
  // single-level rule).
  const curvePartitions = curvePartitionsForRows(spec ?? null, recordRows);
  const linetype = linetypeAccessFor(spec ?? null);
  const channelColorFor = (rows: number[]): string | undefined => {
    if (colorByVariable && colorVarId && colorModel) {
      const level = constantOver(rows, (i) => colorLevelForRow(i, colorModel, ds.loaded, colorVarId) || null);
      return level ? variableColorForLevel(colorVarId, level, colorModel.levels) : undefined;
    }
    if (colorSpec?.kind === "endpoints") return endpointColor(endpoint);
    if (!colorSpec || colorSpec.kind === "dose") {
      const arm = constantOver(rows, (i) => ds.doseLabel(i) || null);
      return arm ? resolveDoseColor(arm) : undefined;
    }
    return undefined;
  };

  if (continuous) {
    // ONE fit gate for every curve (I11): the pooled panel curve routes through
    // the same tryFitForCohort guard as the grouping partitions — a low-support
    // panel keeps its raw points and simply has no curve.
    const pooledFit = tryFitForCohort(metric, endpoint, recordRows);
    const curve = pooledFit ? curveFor(pooledFit.fit, pooledFit.xs, pooledFit.ys, xDomain) : null;

    let levelCurves: Array<{ curve: PredictionResult; color: string; key?: string }> | undefined;
    const builtCurves = curvePartitions.flatMap((part) => {
      let fitted: PredictionResult;
      if (part.key === "") {
        if (!curve) return [];
        fitted = curve;
      } else {
        const f = tryFitForCohort(metric, endpoint, part.rows);
        if (!f) return [];
        fitted = curveFor(f.fit, f.xs, f.ys, xDomain);
      }
      const color = channelColorFor(part.rows);
      const dash = linetype.dashForRows(part.rows, endpoint);
      return [{ curve: fitted, color, dash, key: part.key }];
    });
    // A single unpainted, undashed pooled curve takes the plain pooled styling
    // (neutral gray, SOLID — dash exists only when the linetype rule states one).
    const neutralPooled =
      builtCurves.length === 1 &&
      builtCurves[0]!.key === "" &&
      builtCurves[0]!.color === undefined &&
      !builtCurves[0]!.dash;
    if (builtCurves.length && !neutralPooled) {
      levelCurves = builtCurves.map((c) => ({ ...c, color: c.color ?? "#64748b" }));
    }
    const pointColorFor =
      colorByVariable && colorVarId && colorModel
        ? (p: ScatterPoint) => variableColorForLevel(colorVarId, String(p.groupId), colorModel.levels)
        : colorSpec?.kind === "endpoints"
          ? () => endpointColor(endpoint)
          : undefined;


    // ONE projection pipeline (ADR-0012/0013): every selection — split row or
    // pooled dose — resolves through the shared dist-selection path (rows =
    // clicked group ∩ panel cohort; color via colorForDistGroupId under the
    // one-channel law; pooled selections expand to curve granularity). The old
    // dose-branch mapping fell through to resolveDoseColor under split strips —
    // the recurring "magenta vestigial".
    const rowPaint = resolveDoseRowPaint(spec ?? null, panel);
    const projected: ProjectedGroup[] = projectedGroupsForDistSelection(
      metric,
      endpoint,
      active,
      cohort,
      { spec, colorOverride: rowPaint.fixedColor }
    );

    scatterResult = renderContinuousScatterViaRenderer(
      points,
      curve,
      projected,
      xDomain,
      metric,
      endpoint,
      width,
      computeDisplayReferenceLines(metric, endpoint, cohort),
      computeObservedBinsForPanel(metric, endpoint, cohort, overlayPolicy, colorVarId, colorModel ?? undefined),
      height,
      { curves: levelCurves, pointColorFor }
    );
  } else {
    const refLines = computeDisplayReferenceLines(metric, endpoint, cohort);
    if (colorByVariable && colorVarId && colorModel) {
      const paletteLevels = colorModel.levels;
      // Canonical model order (I1), never row-iteration order: Set-insertion order
      // made "first curve" differ per panel (blue hosted the projection on the
      // left, orange on the right).
      const levels = paletteLevels.filter((l) =>
        recordRows.some((i) => colorLevelForRow(i, colorModel, ds.loaded, colorVarId) === l)
      );
      const pointColors: Record<string | number, string> = {};
      for (const level of levels) pointColors[level] = variableColorForLevel(colorVarId, level, paletteLevels);

      // Degenerate facet+color: plain-dose projections wear the panel's level color.
      const rowPaint = resolveDoseRowPaint(spec ?? null, panel);
      const doseProjected = projectedGroupsForDistSelection(metric, endpoint, active, cohort, {
        spec,
        colorOverride: rowPaint.fixedColor
      });

      // §J: one curve per grouping partition; constancy paints it; projections
      // associate structurally by curveKey (I8: a group rides only its own curve).
      let curves: BinaryCurveOverlay[] = curvePartitions.flatMap((part) => {
        const fitResult = tryFitForCohort(metric, endpoint, part.rows);
        if (!fitResult) return [];
        return [
          {
            curve: curveFor(fitResult.fit, fitResult.xs, fitResult.ys, xDomain),
            color: channelColorFor(part.rows) ?? "#334155",
            dash: linetype.dashForRows(part.rows, endpoint),
            projected: projectedForCurveKey(doseProjected, part.key)
          }
        ];
      });
      if (!curves.length) {
        const fitResult = tryFitForCohort(metric, endpoint, recordRows);
        if (fitResult) {
          curves = [
            {
              curve: curveFor(fitResult.fit, fitResult.xs, fitResult.ys, xDomain),
              color: channelColorFor(recordRows) ?? "#334155",
              dash: linetype.dashForRows(recordRows, endpoint),
              projected: doseProjected
            }
          ];
        }
      }

      scatterResult = renderBinaryScatterOverlay(
        state.showPoints ? points : [],
        curves,
        pointColors,
        xDomain,
        exposureLabel(metric),
        ds.endpointLabel(endpoint),
        width,
        refLines,
        computeObservedBinsForPanel(
          metric,
          endpoint,
          cohort,
          overlayPolicy,
          colorVarId,
          colorModel ?? undefined
        ),
        height
      );
    } else if (scatterPolicy?.scatterPointColorSource === "endpointMonochrome" || colorSpec?.kind === "endpoints") {
      const epColor = endpointColor(endpoint);
      const refLines = computeDisplayReferenceLines(metric, endpoint, cohort);
      // ONE pipeline (E2c): projections match the (neutral) strip rows — one
      // channel; the curve alone carries the endpoint color.
      // ONE paint decider for dose rows AND projection accents (module
      // contract): under constancy a single-endpoint cell's projections wear
      // the endpoint accent — identically to the continuous painter (I7).
      const rowPaint = resolveDoseRowPaint(spec ?? null, panel);
      const projected = projectedGroupsForDistSelection(metric, endpoint, active, cohort, {
        spec,
        colorOverride: rowPaint.fixedColor
      });
      // §J: grouping is legal under the endpoints channel too — one curve per
      // group, each wearing the endpoint color (endpoint is constant per curve).
      const curves: BinaryCurveOverlay[] = curvePartitions.flatMap((part) => {
        const fitResult = tryFitForCohort(metric, endpoint, part.rows);
        if (!fitResult) return [];
        return [
          {
            curve: curveFor(fitResult.fit, fitResult.xs, fitResult.ys, xDomain),
            color: epColor,
            dash: linetype.dashForRows(part.rows, endpoint),
            projected: projectedForCurveKey(projected, part.key)
          }
        ];
      });

      scatterResult = renderBinaryScatterOverlay(
        state.showPoints ? points : [],
        curves,
        pointColorsMonochromeForEndpoint(endpoint),
        xDomain,
        exposureLabel(metric),
        ds.endpointLabel(endpoint),
        width,
        refLines,
        computeObservedBins(metric, endpoint, cohort),
        height
      );
    } else {
      const projected = projectedGroupsForDistSelection(metric, endpoint, active, cohort, { spec });
      // Dose is an ordinary channel (ADR-0012); §J: one curve per grouping
      // partition, arm-colored only when the arm is constant within the group.
      let curves: BinaryCurveOverlay[];
      const splitCurves = curvePartitions.length > 1 || curvePartitions[0]!.key !== "";
      if (splitCurves) {
        curves = curvePartitions.flatMap((part) => {
          const fitResult = tryFitForCohort(metric, endpoint, part.rows);
          if (!fitResult) return [];
          return [
            {
              curve: curveFor(fitResult.fit, fitResult.xs, fitResult.ys, xDomain),
              color: channelColorFor(part.rows) ?? "#334155",
              dash: linetype.dashForRows(part.rows, endpoint),
              // Granularity rule (I8): a group's projection rides only its own curve.
              projected: projectedForCurveKey(projected, part.key)
            }
          ];
        });
      } else {
        const fitResult = tryFitForCohort(metric, endpoint, recordRows);
        // Degenerate facet+dose-color: a single-arm cell keeps its arm color
        // (constancy — same rule variables already have); multi-arm stays neutral.
        const armColor = channelColorFor(recordRows);
        const pooledDash = fitResult ? linetype.dashForRows(recordRows, endpoint) : "";
        curves = fitResult
          ? [
              {
                curve: curveFor(fitResult.fit, fitResult.xs, fitResult.ys, xDomain),
                ...(armColor ? { color: armColor } : {}),
                ...(pooledDash ? { dash: pooledDash } : {}),
                projected
              }
            ]
          : [];
      }

      scatterResult = renderBinaryScatterOverlay(
        state.showPoints ? points : [],
        curves,
        DOSE_COLORS(),
        xDomain,
        exposureLabel(metric),
        endpoint.toUpperCase(),
        width,
        refLines,
        computeObservedBins(metric, endpoint, cohort),
        height
      );
    }
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
  height: number,
  panelId?: string
): void {
  const ds = requireDataset();
  const cohort = cohortForPanel(panelId) ?? dataFilteredRowIndices();
  const xDomain = xDomainForLinkedPanels(metric, panelId);
  const referenceLines = computeDisplayReferenceLines(metric, endpoints[0]!, cohort);

  const pointsFor = (endpoint: Endpoint): ScatterPoint[] => {
    const rows = recordsWithEndpoint(endpoint).filter((i) => !cohort || cohort.includes(i));
    return rows.map((i) => {
      const pid = ds.patientId(i);
      const raw = endpointValue(i, endpoint);
      const linear = isContinuousEndpoint(endpoint);
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
  };

  const spec = resolveActiveViewLayoutSpec();
  const panel = panelId ? scatterPanelById.get(panelId) : undefined;
  const policy =
    spec && panel ? resolvePanelVisualPolicy(spec, panel, endpoints) : null;
  const endpointColoredCurves = policy?.useEndpointColorForProjections ?? true;
  const projectionAccent = (endpoint: Endpoint) =>
    endpointColoredCurves ? endpointColor(endpoint) : DOSE_SELECTION_NEUTRAL;

  // ONE machinery for compare cells too (§J / E2c): curve units come from the
  // shared grouping partitions (endpoint × declared group — grouping now works
  // in overlay cells), and projections come from the ONE selection pipeline
  // (rows = clicked group ∩ panel cohort, curveKey association, deduped labels).
  // Panel cohort everywhere (ADR-0012): a multi-curve cell inside a facet grid
  // must project/summarize THAT panel's rows (user QA round 6). Compare geometry
  // stays user-owned: linear endpoints map onto the 0–1 axis only through the
  // user's normalization bounds (decision 1a — geometry normalized, labels raw).
  const neutralCurves = !endpointColoredCurves;
  const linetype = linetypeAccessFor(spec ?? null);
  const fits = endpoints.map((endpoint) => {
    const rows = recordsWithEndpoint(endpoint).filter((i) => cohort.includes(i));
    const linear = isContinuousEndpoint(endpoint);
    const { min, max, valid } = getCompareNormBounds(endpoint);
    const observedBins = computeCompareObservedBins(metric, endpoint, rows);

    let projected = projectedGroupsForDistSelection(metric, endpoint, active, cohort, {
      spec,
      colorOverride: projectionAccent(endpoint)
    });
    if (linear && valid) {
      projected = projected.map((p) =>
        p.observedSummary
          ? {
              ...p,
              observedSummary: {
                ...p.observedSummary,
                center: normCompareValue(p.observedSummary.center, endpoint),
                lower: normCompareValue(p.observedSummary.lower, endpoint),
                upper: normCompareValue(p.observedSummary.upper, endpoint)
              }
            }
          : p
      );
    }

    const curves: BinaryCurveOverlay[] = curvePartitionsForRows(spec ?? null, rows).flatMap((part) => {
      const fitResult = tryFitForCohort(metric, endpoint, part.rows);
      if (!fitResult) return [];
      const rawCurve = curveFor(fitResult.fit, fitResult.xs, fitResult.ys, xDomain);
      const curve = linear && valid ? mapCurveToCompareScale(rawCurve, min, max) : rawCurve;
      return [
        {
          curve,
          rawCurve: linear ? rawCurve : undefined,
          fitLabelDecimals: linear ? 1 : 2,
          color: neutralCurves ? NEUTRAL_COMPARE_COLOR : endpointColor(endpoint),
          dash: linetype.dashForRows(part.rows, endpoint),
          projected: projectedForCurveKey(projected, part.key)
        }
      ];
    });
    return { endpoint, curves, observedBins };
  });

  const curves: BinaryCurveOverlay[] = fits.flatMap((f) => f.curves);
  const allObservedBins = fits.flatMap((f) => f.observedBins);
  const allPoints = state.showPoints ? fits.flatMap((f) => pointsFor(f.endpoint)) : [];
  const pointColors = Object.fromEntries(endpoints.map((ep) => [ep, endpointColor(ep)]));
  const yLabel = endpoints.some((e) => isContinuousEndpoint(e)) ? "Response (compare 0–1)" : "Response";
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
  const tip = document.createElement("div");
  tip.className = "tooltip";
  chartWrap.appendChild(tip);
  attachScatterInteractivity(chartWrap, tip, metric, endpoints[0]!, result.metadata as unknown as ScatterMeta);
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
  splitByEndpoints?: Endpoint[],
  opts?: {
    cohortRowIndices?: number[];
    splitByColorVariable?: string;
    panelId?: string;
    /** ADR-0012 one-channel rule: rows grouped by dose only render neutral when color ≠ dose. */
    neutralRows?: boolean;
    /** Degenerate facet+color: the panel's single level color for every dose row. */
    fixedRowColor?: string;
    endpointForSplits?: Endpoint;
  }
): DistributionRawGroup[] {
  const spec = resolveActiveViewLayoutSpec();
  const cohort = opts?.cohortRowIndices ?? dataFilteredRowIndices();
  const splitEndpoint =
    opts?.endpointForSplits ?? splitByEndpoints?.[0] ?? selectedEndpoints()[0];
  if (!splitEndpoint) return [];
  const xDomain = xDomainForLinkedPanels(metric, opts?.panelId);
  const pkLike = exposureIsPkMetric(metric);
  const cohortSet = new Set(cohort);
  const inCohort = (i: number) => cohortSet.has(i);

  const selectionAccent = doseSelectionAccentForDistribution();

  const colorVar = opts?.splitByColorVariable;
  if (colorVar && spec?.distribution.colorDistShapes) {
    const loaded = requireDataset().loaded;
    const binning =
      spec?.continuousBinning ??
      (spec?.color.kind === "variable" ? spec.color.binning : undefined);
    // Bin model on the BASE cohort (ADR-0012): cut points and level->color
    // assignment must be identical in every facet panel, even when this dist
    // cell's cohort holds a subset of levels (facet+color on the same variable).
    const colorModel = buildColorBinModel(loaded, colorVar, dataFilteredRowIndices(), binning);
    const levels = colorModel.levels;
    return DOSE_ORDER()
      .slice()
      .reverse()
      .flatMap((dose) => {
        const isPlacebo = isPlaceboDose(dose);
        const subRows = levels
          .map((level) => {
            const rows = rowIndicesForDose(dose).filter(
              (i) => inCohort(i) && colorLevelForRow(i, colorModel, loaded, colorVar) === level
            );
            const values =
              isPlacebo && pkLike ? [] : rows.map((r) => exposureValue(r, metric)).filter((v) => Number.isFinite(v));
            return {
              groupId: `${dose}|${level}`,
              label: "",
              color: variableColorForLevel(colorVar, level, levels),
              values,
              n: rows.length,
              selected: state.selectedDistGroupIds.has(`${dose}|${level}`),
              selectionColor: selectionAccent,
              skipShape: isPlacebo && pkLike,
              splitAnnotations: splitAnnotationsForRows(
                metric,
                splitEndpoint,
                xDomain,
                state.splitAnnotationMode,
                rows,
                isPlacebo && pkLike
              )
            };
          })
          .filter((g) => g.n > 0);
        // Dose label on the first SURVIVING sub-row — the level model is shared
        // across facets (base cohort), so this cell may hold only later levels;
        // labeling level index 0 would leave whole facets unlabeled.
        if (subRows.length) subRows[0]!.label = dose;
        return subRows;
      });
  }

  if (splitByEndpoints && splitByEndpoints.length > 1) {
    return DOSE_ORDER()
      .slice()
      .reverse()
      .flatMap((dose) => {
        const isPlacebo = isPlaceboDose(dose);
        if (!splitByEndpoints.some((ep) => rowIndicesForDose(dose).some((i) => inCohort(i) && Number.isFinite(endpointValue(i, ep))))) {
          return [];
        }
        return splitByEndpoints.map((ep, i) => {
          const rows = rowIndicesForDose(dose).filter((r) => inCohort(r) && Number.isFinite(endpointValue(r, ep)));
          const values =
            isPlacebo && pkLike ? [] : rows.map((r) => exposureValue(r, metric)).filter((v) => Number.isFinite(v));
          return {
            groupId: `${dose}|${ep}`,
            label: i === 0 ? dose : "",
            color: endpointColor(ep),
            values,
            n: rows.length,
            selected: state.selectedDistGroupIds.has(`${dose}|${ep}`),
            selectionColor: selectionAccent,
            skipShape: isPlacebo && pkLike,
            splitAnnotations: splitAnnotationsForRows(
              metric,
              ep,
              xDomain,
              state.splitAnnotationMode,
              rows,
              isPlacebo && pkLike
            )
          };
        });
      });
  }

  return DOSE_ORDER()
    .slice()
    .reverse()
    .map((dose) => {
      const isPlacebo = isPlaceboDose(dose);
      const rows = rowIndicesForDose(dose).filter((i) => inCohort(i));
      const values =
        isPlacebo && pkLike ? [] : rows.map((i) => exposureValue(i, metric)).filter((v) => Number.isFinite(v));
      const rowColor =
        opts?.fixedRowColor ?? (opts?.neutralRows ? NEUTRAL_COMPARE_COLOR : resolveDoseColor(dose));
      return {
        groupId: dose,
        label: dose,
        color: rowColor,
        values,
        n: rows.length,
        selected: state.selectedDoses.has(dose),
        selectionColor: selectionAccent,
        skipShape: isPlacebo && pkLike,
        splitAnnotations: splitAnnotationsForRows(
          metric,
          splitEndpoint,
          xDomain,
          state.splitAnnotationMode,
          rows,
          isPlacebo && pkLike
        )
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
  opts?: { showReadout?: boolean; omitEndpointFit?: boolean; panelId?: string }
): void {
  const distPanel = opts?.panelId ? distPanelById.get(opts.panelId) : undefined;
  const cohortRowIndices = distPanel?.rowIndices ?? dataFilteredRowIndices();
  const xDomain = xDomainForLinkedPanels(metric, opts?.panelId);
  const spec = resolveActiveViewLayoutSpec();
  const colorVar =
    spec?.distribution.colorDistShapes && spec?.color.kind === "variable"
      ? spec.color.variableId
      : undefined;
  const distRowPaint =
    splitByEndpoints && splitByEndpoints.length > 1
      ? {}
      : resolveDoseRowPaint(
          spec ?? null,
          (() => {
            const scatterId = distPanel?.scatterPanelIds[0];
            return scatterId ? scatterPanelById.get(scatterId) : undefined;
          })(),
          // The strip's OWN endpoint scope (enumeration truth): a per-column
          // strip serves one endpoint, a collapsed rows-strip serves them all —
          // constancy is evaluated over this set, not the first cell's.
          distPanel?.readoutEndpointIds ?? readoutEndpoints
        );
  const distGroups = buildDistributionGroups(metric, splitByEndpoints, {
    cohortRowIndices,
    splitByColorVariable: spec?.distribution.colorDistShapes ? colorVar : undefined,
    panelId: opts?.panelId,
    neutralRows: distRowPaint.neutral,
    fixedRowColor: distRowPaint.fixedColor,
    endpointForSplits: endpoint
  });
  registerRenderedDistGroups(distGroups);
  // Content-aware floor (P4): every strip row gets a legible minimum height —
  // the block grows and the plot stage scrolls rather than overprinting dose
  // labels and Ns (row-facet QA 2026-08-24). Painted height matches the floor
  // so the SVG never scales; the resize observer settles any flex re-layout.
  const MIN_DIST_ROW_PX = 18;
  const contentFloor =
    distGroups.length * MIN_DIST_ROW_PX + DISTRIBUTION_MARGIN.top + DISTRIBUTION_MARGIN.bottom;
  const paintHeight = Math.max(height, contentFloor);
  chartWrap.style.minHeight = `${contentFloor}px`;
  const distResult = renderDistributionViaRenderer(
    distGroups,
    xDomain,
    state.distributionMode,
    computeDisplayReferenceLines(metric, endpoint, cohortRowIndices),
    exposureLabel(metric),
    width,
    paintHeight
  );
  chartWrap.innerHTML = distResult.content;
  pinChartSvgToContainer(chartWrap, width, paintHeight);
  if (!readoutEl) return;
  const finalReadoutEndpoints = readoutEndpoints ?? (splitByEndpoints && splitByEndpoints.length > 1 ? splitByEndpoints : [endpoint]);
  attachDistributionInteractivity(chartWrap, metric, finalReadoutEndpoints, active, readoutEl, distResult.metadata, {
    omitEndpointFit: opts?.omitEndpointFit ?? false,
    cohortRowIndices
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
): {
  xSamples: number[];
  boxHalfHeights: number[];
  densityHalfHeights: number[];
  summary: NonNullable<ReturnType<typeof summarizeDistribution>>;
  /** Unified minimum-support rule (I11): below MIN_SUMMARY_N the row abstains
   * from box/violin/lineranges geometry — the raw values render as points. */
  rawPoints?: number[];
} | null {
  const summary = summarizeDistribution(values);
  if (!summary) return null;
  if (summary.tier !== "full") {
    return {
      xSamples: [],
      boxHalfHeights: [],
      densityHalfHeights: [],
      summary,
      rawPoints: values.filter((v) => Number.isFinite(v))
    };
  }
  const bandwidth = silvermanBandwidth(values);
  // ADR-0012: density shapes are TRIMMED at the observed min/max — no KDE
  // extrapolation beyond the data range (a shape past Max reads as fabricated
  // exposure). The kernel still smooths within the range.
  const localDomain: [number, number] = [Math.max(xDomain[0], summary.min), Math.min(xDomain[1], summary.max)];
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
      // Below minimum summary support the layer draws these raw values as
      // points on the row and never touches the (abstaining, NaN-quartile)
      // summary geometry — the tier decision is made HERE, once, not per mode.
      rawPoints: computed?.rawPoints,
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
function computeCompareObservedBins(
  metric: ExposureMetric,
  endpoint: Endpoint,
  cohortRowIndices?: number[]
): ObservedBin[] {
  const neutral = compareDistUsesNeutralShapes();
  const color = neutral ? NEUTRAL_COMPARE_COLOR : endpointColor(endpoint);
  const strokeDash = neutral ? endpointMarkerDash(endpoint) : undefined;
  return computeObservedBins(metric, endpoint, cohortRowIndices).map((b) => ({
    ...b,
    // Compare overlay: GEOMETRY on the normalized 0–1 axis, labels stay native
    // (decision 1a). Binary summaries already live on [0,1]; normCompareValue is
    // identity for them via usesLinearModel gating.
    summary: isContinuousEndpoint(endpoint)
      ? {
          ...b.summary,
          center: normCompareValue(b.summary.center, endpoint),
          lower: normCompareValue(b.summary.lower, endpoint),
          upper: normCompareValue(b.summary.upper, endpoint)
        }
      : b.summary,
    color,
    strokeDash
  }));
}

function renderEndpointLegend(endpoints: Endpoint[]): void {
  endpointLegendEl.innerHTML = "";
  const ds = requireDataset();
  endpoints.forEach((endpoint) => {
    const item = document.createElement("div");
    item.className = "dotKey";
    const color = endpointColor(endpoint);
    const dash = endpointDash(endpoint);
    const linear = isContinuousEndpoint(endpoint);
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

function doseColorFor(dose: string): string {
  if (layoutUsesNeutralDoseChrome()) return DOSE_SELECTION_NEUTRAL;
  return resolveDoseColor(dose);
}

function doseSelectionAccentForDistribution(): string | undefined {
  return layoutUsesNeutralDoseChrome() ? DOSE_SELECTION_NEUTRAL : undefined;
}

function updateStatus(activeCount: number): void {
  const ds = requireDataset();
  const total = ds.rowCount;
  const filterHtml =
    state.dataFilters.length > 0
      ? describeActiveFilters(state.dataFilters, (col) => filterColumnOptions().find((c) => c.id === col)?.label ?? col)
      : "";
  const doseNamesHtml = layoutUsesNeutralDoseChrome()
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

  // ADR-0013: family math via adapters only. Endpoint-finite rows for every
  // family (the old binary branch counted endpoint-missing rows in denominators).
  kpiRespondersBody.innerHTML = endpoints
    .map((endpoint) => {
      const family = observedFamilyFor(endpoint);
      const summarize = (rows: number[]) =>
        family.observedSummary(
          rows.map((i) => endpointValue(i, endpoint)).filter((v) => Number.isFinite(v))
        );
      const cell = (label: string, s: ObservedGroupSummary | null) =>
        s
          ? `<span class="responder-group"><span class="muted">${label}</span> <strong>${s.primaryLabel}</strong> <span class="muted">(${s.secondaryLabel})</span></span>`
          : `<span class="responder-group"><span class="muted">${label}</span> <span class="muted">—</span></span>`;
      return `<div class="responder-row">
        <span class="responder-endpoint">${endpoint.toUpperCase()}</span>
        ${cell("Placebo", summarize(placeboRows))}
        ${cell("Dosed", summarize(dosedRows))}
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
  opts?: { omitEndpointFit?: boolean; cohortRowIndices?: number[] }
): void {
  const ds = requireDataset();
  const omitEndpointFit = opts?.omitEndpointFit ?? false;
  const cohort = opts?.cohortRowIndices;
  const spec = resolveActiveViewLayoutSpec();
  // Same pipeline as projections (ADR-0012): same row resolution (clicked row =
  // dose ∩ level/endpoint ∩ panel cohort), same one-channel color, and fit values
  // from the SAME group the plotted curve was fitted on — never the global fit.
  const colorModel =
    spec?.color.kind === "variable" && dataset
      ? buildColorBinModel(
          dataset.loaded,
          spec.color.variableId,
          dataFilteredRowIndices(),
          spec.continuousBinning ?? spec.color.binning
        )
      : null;
  const colorCtx =
    spec?.color.kind === "variable" && colorModel
      ? { variableId: spec.color.variableId, model: colorModel }
      : undefined;

  const gids = state.selectedDistGroupIds.size ? [...state.selectedDistGroupIds] : [...state.selectedDoses];
  const blocks: string[] = [];
  const grouping = groupingAccessFor(spec ?? null);
  for (const gid of gids) {
    const { suffix } = parseDistGroupId(gid);
    const suffixIsEndpoint = !!suffix && selectedEndpoints().includes(suffix as Endpoint);
    const lineEndpoints = suffixIsEndpoint ? [suffix as Endpoint] : endpoints;
    const refEndpoint = lineEndpoints[0] ?? endpoints[0]!;
    const rows = rowsForDistGroupId(gid, active, cohort, refEndpoint, colorCtx);
    // §J/I8: the readout mirrors curve granularity — a clicked row splits into
    // one line pair per grouping partition (pooled = one, as before).
    const partitions = grouping.keys.length
      ? grouping.keys
          .map((key) => ({ key, rows: rows.filter((i) => grouping.keyForRow(i) === key) }))
          .filter((p) => p.rows.length > 0)
      : [{ key: "", rows }];
    for (const part of partitions) {
      const vals = part.rows
        .map((i) => exposureValue(i, metric))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
      const s = summarizeDistribution(vals);
      if (!s) continue;
      const groupColor = colorForDistGroupId(gid, refEndpoint, spec, colorModel, part.rows);
      // ONE label composer (analysis pipeline): key parts already in the row's
      // identity (dose / channel level) are deduped there.
      const label = selectionGroupLabel({ knownEndpointIds: selectedEndpoints() }, gid, part.key);
      // Unified minimum-support rule (I11): the readout only prints statistics
      // the group's N honestly supports — quartiles abstain below MIN_SUMMARY_N.
      const exposureStats =
        s.tier === "full"
          ? `Min ${exposureLabel(metric)} = ${s.min.toFixed(1)} &nbsp; Q1 = ${s.q1.toFixed(1)} &nbsp; Median = ${s.median.toFixed(1)} &nbsp; Q3 = ${s.q3.toFixed(1)} &nbsp; Max = ${s.max.toFixed(1)} &nbsp; N=${part.rows.length}`
          : s.tier === "minimal"
            ? `Min ${exposureLabel(metric)} = ${s.min.toFixed(1)} &nbsp; Median = ${s.median.toFixed(1)} &nbsp; Max = ${s.max.toFixed(1)} &nbsp; N=${part.rows.length} &nbsp; <span class="muted">quartiles need N ≥ ${MIN_SUMMARY_N}</span>`
            : `${exposureLabel(metric)} = ${s.median.toFixed(1)} &nbsp; N=${part.rows.length}`;
      blocks.push(
        `<div class="readout-line-exposure"><strong style="color:${groupColor}">${escapeHtml(label)}</strong> &nbsp; ${exposureStats}</div>`
      );

      if (omitEndpointFit) continue;

      for (const endpoint of lineEndpoints) {
        // Fit rows mirror the plotted curve group (§J): the panel cohort filtered
        // to this partition's group — pooled when no grouping is declared.
        const fitBase = (cohort ?? dataFilteredRowIndices()).filter((i) =>
          Number.isFinite(endpointValue(i, endpoint))
        );
        const fitRows = part.key ? fitBase.filter((i) => grouping.keyForRow(i) === part.key) : fitBase;
        const fitResult = tryFitForCohort(metric, endpoint, fitRows);
        if (!fitResult) {
          // I11: the fit ABSTAINED (below MIN_FIT_N or the family refused) —
          // say so instead of silently omitting the line.
          const naLabel = lineEndpoints.length > 1 || endpoints.length > 1 ? ds.endpointLabel(endpoint) : label;
          blocks.push(
            `<div class="readout-line-fit"><span class="muted">${escapeHtml(naLabel)} — fit n/a (N=${fitRows.length})</span></div>`
          );
          continue;
        }
        const fit = fitResult.fit;
        // ADR-0013: readout DECIMALS follow the endpoint's DATA KIND (loess on a
        // binary endpoint still reads as probabilities); fitted values come from
        // the fitted family's own evaluator.
        const decimals = isContinuousEndpoint(endpoint)
          ? linearFamily.readoutDecimals
          : logisticFamily.readoutDecimals;
        const fitAt = (x: number): number =>
          fit.kind === "loess"
            ? predictLoessAt(fit.model, x).estimate
            : fit.kind === "emax"
              ? predictEmaxAt(fit.model, x).estimate
              : fit.kind === "linear"
                ? linearFamily.fittedAt(fit.model as never, x)
                : logisticFamily.fittedAt(fit.model as never, x);
        const lineColor = spec?.color.kind === "endpoints" ? endpointColor(endpoint) : groupColor;
        const lineLabel = lineEndpoints.length > 1 || endpoints.length > 1 ? ds.endpointLabel(endpoint) : label;
        const endpointN = part.rows.filter((i) => Number.isFinite(endpointValue(i, endpoint))).length;
        const missing = part.rows.length - endpointN;
        const nNote =
          missing === 0 ? "" : ` &nbsp; <span class="muted">${missing} missing from N=${part.rows.length}</span>`;
        // The fit line mirrors the exposure line's tier: fitted values only at
        // the quantiles the clicked group's N honestly supports (I11).
        const fitStats =
          s.tier === "full"
            ? `fit @ Min ${fitAt(s.min).toFixed(decimals)} · Q1 ${fitAt(s.q1).toFixed(decimals)} · Med ${fitAt(s.median).toFixed(decimals)} · Q3 ${fitAt(s.q3).toFixed(decimals)} · Max ${fitAt(s.max).toFixed(decimals)}`
            : s.tier === "minimal"
              ? `fit @ Min ${fitAt(s.min).toFixed(decimals)} · Med ${fitAt(s.median).toFixed(decimals)} · Max ${fitAt(s.max).toFixed(decimals)}`
              : `fit @ ${s.median.toFixed(1)} → ${fitAt(s.median).toFixed(decimals)}`;
        blocks.push(
          `<div class="readout-line-fit" title="${escapeAttr(describeFitTooltip(fit))}"><span style="color:${lineColor}">${escapeHtml(lineLabel)}</span> — ${fitStats}${nNote}</div>`
        );
      }
    }
  }
  if (!blocks.length) {
    readoutEl.innerHTML =
      '<span class="muted">Click a box above to show projected fit values at Min, Q1, Median, Q3, and Max.</span>';
    return;
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
  readoutOpts?: { omitEndpointFit?: boolean; cohortRowIndices?: number[] }
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
      const raw = g.getAttribute("data-group");
      if (!raw || distributionAnimating) return;
      if (raw.includes("|")) {
        if (state.selectedDistGroupIds.has(raw)) state.selectedDistGroupIds.delete(raw);
        else state.selectedDistGroupIds.add(raw);
        state.selectedDoses.clear();
      } else {
        state.selectedDistGroupIds.clear();
        if (state.selectedDoses.has(raw)) state.selectedDoses.delete(raw);
        else state.selectedDoses.add(raw);
      }
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
  state.selectedDistGroupIds.clear();
  render();
}

/* ---------------------------------------------------------------------- *
 * Dataset upload / column mapping
 * ---------------------------------------------------------------------- */

/** (b) The Endpoint Models line under each select: the pooled filtered-cohort
 * fit's equation + parameter estimates, via the universal {@link describeFit}
 * — computed on the PRIMARY exposure metric (same convention `buildSessionState`
 * uses); silently omitted when there is no primary metric or the fit abstains
 * (below minimum support), same as the readout's own "fit n/a" case elsewhere. */
function pooledFitDescriptionHtml(endpoint: Endpoint): string {
  const metric = selectedExposureMetrics()[0];
  if (!metric) return "";
  const fitResult = tryFitForCohort(metric, endpoint, recordsWithEndpoint(endpoint));
  if (!fitResult) return "";
  const { equation, params, warning } = describeFit(fitResult.fit);
  const paramText = params
    .map((p) => `${p.label} = ${p.value.toFixed(3)}${p.se !== undefined ? ` ± ${p.se.toFixed(3)}` : ""}`)
    .join(" &nbsp; ");
  const warningHtml = warning
    ? `<div class="endpoint-model-warning">${escapeHtml(warning)}</div>`
    : "";
  return `<div class="endpoint-model-equation muted">${escapeHtml(equation)} &nbsp; — &nbsp; ${paramText}</div>${warningHtml}`;
}

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
      // Model options follow the DATA KIND (ADR-0013): binary endpoints choose
      // Logistic or Loess; continuous choose Linear, Loess, or Emax (Emax is
      // continuous-only — see .ai/CONTINUE_HERE.md). Loess/Emax expose their
      // user-owned tuning per endpoint.
      const continuous = endpointDataKind(ds, e) === "continuous";
      const nativeOption = continuous
        ? `<option value="linear" ${model === "linear" ? "selected" : ""}>Linear</option>`
        : `<option value="logistic" ${model === "logistic" ? "selected" : ""}>Logistic</option>`;
      const emaxOption = continuous
        ? `<option value="emax" ${model === "emax" ? "selected" : ""}>Emax</option>`
        : "";
      const loess = loessSettingsFor(e);
      const loessControls =
        model === "loess"
          ? `<span class="loess-controls">span <input type="number" data-loess-span="${escapeAttr(e)}" value="${loess.span}" min="0.1" max="2" step="0.05" style="width:64px" />
             deg <select data-loess-degree="${escapeAttr(e)}" style="width:52px"><option value="1" ${loess.degree === 1 ? "selected" : ""}>1</option><option value="2" ${loess.degree === 2 ? "selected" : ""}>2</option></select></span>`
          : "";
      const emax = emaxSettingsFor(e);
      const emaxControls =
        model === "emax"
          ? `<span class="emax-controls">
               <label><input type="checkbox" data-emax-gamma="${escapeAttr(e)}" ${emax.estimateGamma ? "checked" : ""} /> estimate γ (sigmoidicity)</label>
               <label><input type="checkbox" data-emax-e0="${escapeAttr(e)}" ${emax.estimateE0 ? "checked" : ""} /> estimate E0 (baseline)</label>
             </span>`
          : "";
      return `<div class="endpoint-model-row" data-endpoint="${escapeAttr(e)}">
        <span>${escapeHtml(ds.endpointLabel(e))}</span>
        <select data-endpoint-model="${escapeAttr(e)}">
          ${nativeOption}
          <option value="loess" ${model === "loess" ? "selected" : ""}>Loess</option>
          ${emaxOption}
        </select>
        ${loessControls}
        ${emaxControls}
        ${pooledFitDescriptionHtml(e)}
      </div>`;
    })
    .join("");
  endpointModelsListEl.querySelectorAll<HTMLSelectElement>("select[data-endpoint-model]").forEach((sel) => {
    sel.onchange = () => {
      const ep = sel.dataset.endpointModel as Endpoint | undefined;
      if (!ep) return;
      const val =
        sel.value === "linear" || sel.value === "loess" || sel.value === "emax"
          ? (sel.value as EndpointAnalysisModel)
          : "logistic";
      state.endpointModels[ep] = val;
      if (isContinuousEndpoint(ep)) ensureNormScaleForEndpoint(ep);
      syncCompareNormUi(selectedEndpoints(), guidedOverlayActive(selectedEndpoints().length));
      syncEndpointModelsUi();
      render();
    };
  });
  endpointModelsListEl.querySelectorAll<HTMLInputElement>("input[data-loess-span]").forEach((inp) => {
    inp.onchange = () => {
      const ep = inp.dataset.loessSpan as Endpoint | undefined;
      if (!ep) return;
      const span = Number(inp.value);
      if (!Number.isFinite(span) || span < 0.1 || span > 2) return;
      state.loessSettings[ep] = { ...loessSettingsFor(ep), span };
      // Refresh the (b) pooled-fit equation preview too — every model's
      // settings change should update it identically, loess included.
      syncEndpointModelsUi();
      render();
    };
  });
  endpointModelsListEl.querySelectorAll<HTMLSelectElement>("select[data-loess-degree]").forEach((sel) => {
    sel.onchange = () => {
      const ep = sel.dataset.loessDegree as Endpoint | undefined;
      if (!ep) return;
      state.loessSettings[ep] = { ...loessSettingsFor(ep), degree: sel.value === "1" ? 1 : 2 };
      syncEndpointModelsUi();
      render();
    };
  });
  endpointModelsListEl.querySelectorAll<HTMLInputElement>("input[data-emax-gamma]").forEach((inp) => {
    inp.onchange = () => {
      const ep = inp.dataset.emaxGamma as Endpoint | undefined;
      if (!ep) return;
      state.emaxSettings[ep] = { ...emaxSettingsFor(ep), estimateGamma: inp.checked };
      syncEndpointModelsUi();
      render();
    };
  });
  endpointModelsListEl.querySelectorAll<HTMLInputElement>("input[data-emax-e0]").forEach((inp) => {
    inp.onchange = () => {
      const ep = inp.dataset.emaxE0 as Endpoint | undefined;
      if (!ep) return;
      state.emaxSettings[ep] = { ...emaxSettingsFor(ep), estimateE0: inp.checked };
      syncEndpointModelsUi();
      render();
    };
  });
}

function syncCompareDistUi(comparisonEligible: boolean): void {
  const showSplit = guidedOverlayActive(selectedEndpoints().length) && comparisonEligible;
  const splitLabel = compareDistByEndpointEl.closest("label");
  if (splitLabel) splitLabel.hidden = !showSplit;
  if (!showSplit) {
    if (state.compareDistByEndpoint) {
      state.compareDistByEndpoint = false;
      compareDistByEndpointEl.checked = false;
    }
  }
}

function syncCompareNormUi(endpoints: Endpoint[], show: boolean): void {
  if (!dataset || !show) {
    compareNormSectionEl.hidden = true;
    compareNormListEl.innerHTML = "";
    return;
  }
  const ds = dataset;
  const linearEps = endpoints.filter((e) => isContinuousEndpoint(e));
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
      // Valueless operators (is missing / is not missing) take no value: hide the
      // value editor and the categorical-mode toggle instead of showing dead inputs.
      const valueless = rule.operator === "missing" || rule.operator === "notMissing";
      const catPickers = valueless
        ? ""
        : categorical && distinct.length
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
          <div class="filter-mode-row" ${valueless ? "hidden" : ""}><label><input type="checkbox" data-filter-cat-mode="${escapeAttr(rule.id)}" ${categorical ? "checked" : ""} /> Categorical (pick values)</label></div>
          <select data-filter-op="${escapeAttr(rule.id)}">${ops}</select>
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
      syncFiltersUi();
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
      syncCompareNormUi([...nextSelected], guidedOverlayActive(nextSelected.size));
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
  document
    .querySelectorAll<HTMLInputElement>('input[name="calloutDensity"]')
    .forEach((rb) => (rb.checked = rb.value === state.calloutDensity));
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
      const roleLabel =
        role === "exposure" ? `exposure · ${exposureIsPkMetric(col) ? "PK" : "NON-PK"}` : role;
      return `<li><span class="col-name">${escapeHtml(col)}</span><span class="col-role">${escapeHtml(roleLabel)}</span></li>`;
    })
    .filter(Boolean);
  columnRolesListEl.innerHTML = items.length
    ? items.join("")
    : `<li><span class="col-name muted">No mapped columns</span></li>`;
  columnRolesSummaryEl.hidden = false;
  referenceArmFieldEl.hidden = false;
  syncReferenceArmUi();
  syncExposurePkUi();
}

/** Push the current recode maps onto the loaded dataset (the ONE level-model layer reads them). */
function applyVariableRecodes(): void {
  if (dataset) setVariableRecodes(dataset.loaded, state.variableRecodes);
}

/** Categorical COVARIATES (level-model has no cuts) — the recode-eligible set.
 * Dose is excluded (arm labels are read raw by the dose machinery: DOSE_ORDER,
 * reference-arm matching); endpoints are numeric responses, not level sets. */
function recodeEligibleVariables(): Array<{ id: string; label: string }> {
  if (!dataset) return [];
  const base = dataFilteredRowIndices();
  return filterColumnOptions()
    .filter((c) => c.role === "covariate")
    .filter((c) => !buildColorBinModel(dataset!.loaded, c.id, base).binning)
    .map((c) => ({ id: c.id, label: c.label }));
}

function refreshRecodeUi(): void {
  if (!dataset) {
    recodeSectionEl.hidden = true;
    return;
  }
  const vars = recodeEligibleVariables();
  recodeSectionEl.hidden = vars.length === 0;
  if (!vars.length) return;
  const keep = recodeVariableSelectEl.value;
  recodeVariableSelectEl.innerHTML = "";
  for (const v of vars) {
    const opt = document.createElement("option");
    opt.value = v.id;
    const active = state.variableRecodes[v.id];
    opt.textContent = active ? v.label + " (recoded)" : v.label;
    recodeVariableSelectEl.appendChild(opt);
  }
  if ([...recodeVariableSelectEl.options].some((o) => o.value === keep)) recodeVariableSelectEl.value = keep;
  renderRecodeEditor(recodeVariableSelectEl.value);
}

function renderRecodeEditor(variableId: string): void {
  recodeEditorEl.innerHTML = "";
  if (!dataset || !variableId) return;
  const ds = requireDataset();
  const col = getColumn(ds.loaded, variableId);
  const base = dataFilteredRowIndices();

  // RAW levels with N/% - frequency is how rare categories are spotted.
  const counts = new Map<string, number>();
  let missingN = 0;
  for (const i of base) {
    const raw = col[i];
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      missingN++;
      continue;
    }
    const s = String(raw).trim();
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const rawLevels = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const recode: VariableRecode = state.variableRecodes[variableId] ?? { map: {} };
  const total = base.length || 1;

  const commit = (next: VariableRecode | null) => {
    if (next && (Object.keys(next.map).length || next.order?.length)) {
      state.variableRecodes[variableId] = next;
    } else {
      delete state.variableRecodes[variableId];
    }
    applyVariableRecodes();
    refreshRecodeUi();
    syncFiltersUi();
    render();
  };

  const table = document.createElement("div");
  for (const raw of rawLevels) {
    const target = recode.map[raw] ?? raw;
    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:minmax(0,1fr) 74px minmax(0,1.2fr) auto;gap:6px;align-items:center;margin-bottom:4px;";
    const n = counts.get(raw)!;
    const pct = ((n / total) * 100).toFixed(n / total < 0.1 ? 1 : 0);
    const isMissingTarget = target === MISSING_LEVEL;
    row.innerHTML =
      '<span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;" title="' + escapeAttr(raw) + '">' +
      escapeHtml(raw) +
      '</span><span class="field-hint" style="margin:0">N=' + n + " (" + pct + "%)</span>";
    const input = document.createElement("input");
    input.type = "text";
    input.value = isMissingTarget ? "" : target;
    input.placeholder = isMissingTarget ? "(missing)" : raw;
    input.disabled = isMissingTarget;
    input.addEventListener("change", () => {
      const next: VariableRecode = { map: { ...recode.map }, order: recode.order ? [...recode.order] : undefined };
      const v = input.value.trim();
      if (!v || v === raw) delete next.map[raw];
      else next.map[raw] = v;
      commit(next);
    });
    const missBtn = document.createElement("button");
    missBtn.type = "button";
    missBtn.className = "btn btn-sm";
    missBtn.textContent = isMissingTarget ? "restore" : "-> (missing)";
    missBtn.title = isMissingTarget
      ? "Treat this level as a real category again"
      : "Route this coded value into the explicit (missing) level";
    missBtn.addEventListener("click", () => {
      const next: VariableRecode = { map: { ...recode.map }, order: recode.order ? [...recode.order] : undefined };
      if (isMissingTarget) delete next.map[raw];
      else next.map[raw] = MISSING_LEVEL;
      commit(next);
    });
    row.append(input, missBtn);
    table.appendChild(row);
  }
  recodeEditorEl.appendChild(table);
  if (missingN > 0) {
    const note = document.createElement("p");
    note.className = "field-hint";
    note.textContent = missingN + " row(s) already missing - they stay in (missing).";
    recodeEditorEl.appendChild(note);
  }

  // Output order - drag to reorder; the dragged order IS the level order
  // everywhere (palette, facets, strips, dashes). "(missing)" pinned last (I9).
  const model = buildColorBinModel(ds.loaded, variableId, base);
  const outputs = model.levels.filter((l) => l !== MISSING_LEVEL);
  const orderTitle = document.createElement("p");
  orderTitle.className = "field-hint";
  orderTitle.style.margin = "8px 0 2px";
  orderTitle.textContent = "Display order (drag) - drives colors, facets, strips, and dashes:";
  recodeEditorEl.appendChild(orderTitle);
  const orderList = document.createElement("ul");
  recodeEditorEl.appendChild(orderList);
  mountSortableChips(
    orderList,
    outputs,
    (nextOrder) => {
      const next: VariableRecode = { map: { ...recode.map }, order: nextOrder };
      commit(next);
    },
    { pinnedTail: model.hasMissing ? [MISSING_LEVEL] : [] }
  );

  if (state.variableRecodes[variableId]) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn-sm";
    reset.style.marginTop = "6px";
    reset.textContent = "Reset recode for this variable";
    reset.addEventListener("click", () => commit(null));
    recodeEditorEl.appendChild(reset);
  }
}

function activateDataset(next: DatasetContext, statusMessage?: string, options?: { focusPlot?: boolean }): void {
  dataset = next;
  applyVariableRecodes();
  // Materialize the inferred reference arms as an explicit selection so the
  // picker's empty state can mean "no reference arm" without re-inference.
  if (!state.referenceArmDoses.length) state.referenceArmDoses = inferDefaultReferenceArmDoses();
  state.exposureColumnOrder = [...next.exposureOrder()];
  state.endpointColumnOrder = [...next.endpointOrder()];
  state.brushedIds = null;
  state.selectedDoses.clear();
  ensureEndpointAnalysisDefaults();
  syncMetricEndpointControls();
  syncFiltersUi();
  refreshAdvancedColorOptions();
  refreshAdvancedFacetOptions();
  mappingPanelEl.style.display = "none";
  pendingCsvRows = null;
  pendingDatasetMeta = null;
  dataStatusEl.textContent = statusMessage ?? `${dataset.datasetName} — ${dataset.rowCount} rows`;
  syncColumnRolesSummary();
  refreshRecodeUi();
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
  mappingPanelEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
      selectedDoses: [...state.selectedDoses],
      // ADR-0012 (C2): the domain ViewSelection is the serialized selection
      // contract — split rows (dose × endpoint / dose × level) survive reload.
      viewSelection: {
        selectedDoses: [...state.selectedDoses],
        selectedDistGroups: [...state.selectedDistGroupIds].map((gid) =>
          parseDistGroupRef(gid, endpoints)
        )
      } satisfies ViewSelection
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
      guidedPreset: state.guidedPreset,
      calloutDensity: state.calloutDensity,
      variableRecodes: JSON.parse(JSON.stringify(state.variableRecodes)),
      exposurePkOverrides: { ...state.exposurePkOverrides },
      showPoints: state.showPoints,
      doseColorScheme: state.doseColorScheme,
      endpointColorScheme: state.endpointColorScheme,
      endpointModels: { ...state.endpointModels },
      loessSettings: { ...state.loessSettings },
      emaxSettings: { ...state.emaxSettings },
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
      layoutMode: state.layoutMode,
      advancedViewLayout: state.advancedViewLayout,
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
      const layoutModeSaved = session.settings["layoutMode"];
      if (layoutModeSaved === "guided" || layoutModeSaved === "advanced") {
        state.layoutMode = layoutModeSaved;
      }
      const advSaved = session.settings["advancedViewLayout"];
      if (advSaved && typeof advSaved === "object") {
        state.advancedViewLayout = advSaved as ViewLayoutSpec;
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
      state.showPoints = session.settings["showPoints"] !== false;
      state.calloutDensity = session.settings["calloutDensity"] === "all" ? "all" : "selected";
      const recodesRaw = session.settings["variableRecodes"];
      state.variableRecodes =
        recodesRaw && typeof recodesRaw === "object" && !Array.isArray(recodesRaw)
          ? (JSON.parse(JSON.stringify(recodesRaw)) as Record<string, VariableRecode>)
          : {};
      applyVariableRecodes();
      refreshRecodeUi();
      const pkRaw = session.settings["exposurePkOverrides"];
      state.exposurePkOverrides =
        pkRaw && typeof pkRaw === "object" && !Array.isArray(pkRaw)
          ? ({ ...(pkRaw as Record<string, boolean>) } as Record<string, boolean>)
          : {};
      syncExposurePkUi();
      const presetRaw = session.settings["guidedPreset"];
      if (presetRaw === "endpoint-rows" || presetRaw === "exposure-rows" || presetRaw === "overlay") {
        state.guidedPreset = presetRaw;
      } else {
        // Legacy sessions (pre-E4 presets): compareEndpoints boolean + gridLayout.
        const gridRaw = session.settings["gridLayout"];
        state.guidedPreset =
          session.settings["compareEndpoints"] === true
            ? "overlay"
            : gridRaw === "exposure-rows"
              ? "exposure-rows"
              : "endpoint-rows";
      }
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
      const loessRaw = session.settings["loessSettings"];
      if (loessRaw && typeof loessRaw === "object" && !Array.isArray(loessRaw)) {
        state.loessSettings = { ...(loessRaw as Record<string, { span: number; degree: 1 | 2 }>) };
      }
      const emaxRaw = session.settings["emaxSettings"];
      if (emaxRaw && typeof emaxRaw === "object" && !Array.isArray(emaxRaw)) {
        state.emaxSettings = { ...(emaxRaw as Record<string, { estimateGamma: boolean; estimateE0: boolean }>) };
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
      state.selectedDistGroupIds = new Set();
      const vs = session.filters["viewSelection"] as ViewSelection | undefined;
      if (vs && Array.isArray(vs.selectedDoses) && Array.isArray(vs.selectedDistGroups)) {
        state.selectedDoses = new Set(vs.selectedDoses);
        state.selectedDistGroupIds = new Set(vs.selectedDistGroups.map((ref) => formatDistGroupId(ref)));
      }

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
      document
        .querySelectorAll<HTMLInputElement>('input[name="calloutDensity"]')
        .forEach((rb) => (rb.checked = rb.value === state.calloutDensity));
      compareDistByEndpointEl.checked = state.compareDistByEndpoint;
      syncFiltersUi();
      showPointsEl.checked = state.showPoints;
      syncGuidedPresetUi();
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

compareDistByEndpointEl.addEventListener("change", () => {
  state.compareDistByEndpoint = compareDistByEndpointEl.checked;
  render();
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
recodeVariableSelectEl.addEventListener("change", () => renderRecodeEditor(recodeVariableSelectEl.value));

document.querySelectorAll<HTMLInputElement>('input[name="calloutDensity"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    state.calloutDensity = radio.value === "all" ? "all" : "selected";
    render();
  });
});

guidedPresetRadios().forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    const val = radio.value;
    state.guidedPreset = val === "exposure-rows" || val === "overlay" ? (val as GuidedPreset) : "endpoint-rows";
    if (state.guidedPreset !== "overlay") {
      state.compareDistByEndpoint = false;
      compareDistByEndpointEl.checked = false;
    }
    syncCompareNormUi(selectedEndpoints(), guidedOverlayActive(selectedEndpoints().length));
    render();
  });
});

document.querySelectorAll<HTMLInputElement>('input[name="layoutMode"]').forEach((rb) => {
  rb.addEventListener("change", () => {
    if (!rb.checked) return;
    state.layoutMode = rb.value === "advanced" ? "advanced" : "guided";
    if (state.layoutMode === "advanced" && !state.advancedViewLayout) {
      state.advancedViewLayout = defaultAdvancedLayout(
        selectedEndpoints(),
        endpointOrder(),
        selectedExposureMetrics(),
        exposureOrder()
      );
    }
    syncLayoutModeUi({ refreshAdvancedControls: state.layoutMode === "advanced" });
    render();
  });
});

resetAdvancedToGuidedBtn.addEventListener("click", () => {
  state.advancedViewLayout = defaultAdvancedSpecFromGuided(guidedLayoutInput());
  syncLayoutModeUi({ refreshAdvancedControls: true });
  render();
});

function bindAdvancedLayoutInput(el: HTMLElement): void {
  el.addEventListener("change", () => {
    if (state.layoutMode !== "advanced") return;
    if (el === advancedRowFacetsEl || el === advancedColFacetsEl) {
      refreshAdvancedColorOptions();
      reconcileAdvancedColorWithFacets();
    }
    state.advancedViewLayout = pullAdvancedSpecFromUi();
    syncAdvancedFitByColorUi(state.advancedViewLayout);
    updateAdvancedLayoutStatus(state.advancedViewLayout);
    render();
  });
}
[
  advancedRowFacetsEl,
  advancedColFacetsEl,
  advancedColorByEl,
  advancedColorBinningEl,
  advancedGroupCurvesEl,
  advancedLinetypeByEl,
  advancedColorDistShapesEl
].forEach(bindAdvancedLayoutInput);

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
