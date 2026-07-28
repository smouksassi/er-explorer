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
} from "@er-explorer/analysis";
import { linearAnalysisModel, meanConfidenceInterval, type LinearParams } from "@er-explorer/model-linear";
import {
  renderLogisticScatterChart,
  renderLinearScatterChart,
  renderDistributionChart,
  buildAsymRidgePath,
  scaleLinear,
  seededJitter,
  createVisualizationSpec,
  type Scale,
  type ScatterPoint,
  type ProjectedGroup,
  type LinearProjectedGroup,
  type ObservedMeanBin,
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
type Endpoint = "icgi" | "icgi2" | "icgi3" | "brls" | "prls";
type CIMethod = "wald" | "bootstrap";

const EXPOSURE_ORDER: ExposureMetric[] = ["auc", "cmax"];
const ENDPOINT_ORDER: Endpoint[] = ["icgi", "icgi2", "icgi3", "brls", "prls"];
/** BRLS/PRLS are continuous rating-scale endpoints (mean response +- CI, no responder concept) -
 * fit with the @er-explorer/model-linear plugin instead of the legacy logistic implementation.
 * Every other endpoint here is a binary responder/non-responder outcome. */
const CONTINUOUS_ENDPOINTS: ReadonlySet<Endpoint> = new Set(["brls", "prls"]);
function isContinuousEndpoint(endpoint: Endpoint): boolean {
  return CONTINUOUS_ENDPOINTS.has(endpoint);
}
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
  icgi3: "#C44E52",
  brls: "#55A868",
  prls: "#8172B2"
};
/** SVG stroke-dasharray per endpoint (solid / dotted / dashed) so overlaid curves stay
 * distinguishable even without color (e.g. print, colorblind-safe redundancy). */
const ENDPOINT_DASH: Record<Endpoint, string> = {
  icgi: "",
  icgi2: "2 4",
  icgi3: "9 4",
  brls: "4 3",
  prls: "1 3"
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
  /** Show each active reference-line split's own fitted value + CI, marked right on the curve
   * (e.g. "Fit 0.74 [0.70-0.78]"; for a continuous endpoint this is a fitted response, not a
   * probability). Independent of showSplitValue below - the two used to be bundled into one
   * marker. Off by default - opt-in, both because it's another marker competing for the same
   * space as showObservedResponders, and because its grey styling is easy to mix up with the
   * (near-black) observed markers if always on. */
  showReferenceFit: boolean;
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
  showSplitValue: false,
  showDoseObserved: true,
  compareEndpoints: false,
  showPoints: true
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
const legendEl = $<HTMLDivElement>("legend");
const statusEl = $<HTMLDivElement>("status");
const exposureGroupEl = $<HTMLDivElement>("exposureGroup");
const distModeGroupEl = $<HTMLDivElement>("distModeGroup");
const refLineGroupEl = $<HTMLDivElement>("refLineGroup");
const refLineNoteEl = $<HTMLDivElement>("refLineNote");
const splitAnnotationModeEl = $<HTMLSelectElement>("splitAnnotationMode");
const showObservedRespEl = $<HTMLInputElement>("showObservedResp");
const showReferenceFitEl = $<HTMLInputElement>("showReferenceFit");
const showSplitValueEl = $<HTMLInputElement>("showSplitValue");
const showDoseObservedEl = $<HTMLInputElement>("showDoseObserved");
const showPointsEl = $<HTMLInputElement>("showPoints");
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
const kpiRespondersBody = $<HTMLDivElement>("kpiRespondersBody");
const kpiShowing = $<HTMLDivElement>("kpiShowing");

const exposureValue = (r: ExposureResponseRecord, metric: ExposureMetric) => (metric === "auc" ? r.auc : r.cmax);
/** BRLS/PRLS are `number | null` in the generated data (a handful of patients have no
 * post-baseline rating at a given visit) - a missing value comes back as `NaN` here rather than
 * `null`, so any accidental unfiltered arithmetic on it visibly propagates as NaN instead of
 * silently coercing null to 0. ICGI/ICGI2/ICGI3 are never missing, so this is a no-op for them. */
const endpointValue = (r: ExposureResponseRecord, endpoint: Endpoint): number =>
  endpoint === "icgi"
    ? r.icgi
    : endpoint === "icgi2"
      ? r.icgi2
      : endpoint === "icgi3"
        ? r.icgi3
        : endpoint === "brls"
          ? r.brls ?? NaN
          : r.prls ?? NaN;
/** Every record whose response for `endpoint` is actually present - the base row set every
 * fit/plot/summary for that endpoint should use instead of `RECORDS` directly, so the handful of
 * patients missing a BRLS/PRLS rating are excluded rather than plotted/fit as if their response
 * were 0. A no-op filter for the binary endpoints, which are never missing. */
function recordsWithEndpoint(endpoint: Endpoint): ExposureResponseRecord[] {
  return RECORDS.filter((r) => Number.isFinite(endpointValue(r, endpoint)));
}
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

/** A fitted model for one metric/endpoint pair, tagged by which family produced it - "logistic"
 * for the existing binary responder endpoints (ICGI/ICGI2/ICGI3), "linear" (the
 * @er-explorer/model-linear plugin) for the continuous rating-scale endpoints (BRLS/PRLS). Both
 * `LogisticModel` and `LinearParams` expose `intercept`/`slope`, so most call sites only need to
 * branch on `kind` where the two families' meaning actually diverges (the response scale, and
 * whether a fitted value needs a sigmoid transform). */
type EndpointFit = { kind: "logistic"; model: LogisticModel } | { kind: "linear"; model: LinearParams };

function fitFor(metric: ExposureMetric, endpoint: Endpoint): { fit: EndpointFit; xs: number[]; ys: number[] } {
  const xs = RECORDS.map((r) => exposureValue(r, metric));
  const ys = RECORDS.map((r) => endpointValue(r, endpoint));
  if (isContinuousEndpoint(endpoint)) {
    const outcome = linearAnalysisModel.fit({ exposures: xs, responses: ys });
    if (!outcome.optimization.converged) throw new Error(`Unable to fit linear model for ${metric}/${endpoint}`);
    return { fit: { kind: "linear", model: outcome.params }, xs, ys };
  }
  const model = fitLogisticModel(xs, ys);
  if (!model) throw new Error(`Unable to fit logistic model for ${metric}/${endpoint}`);
  return { fit: { kind: "logistic", model }, xs, ys };
}

function curveFor(fit: EndpointFit, xs: number[], ys: number[], xMax: number): PredictionResult {
  const dense = Array.from({ length: 121 }, (_, i) => (i * xMax) / 120);
  if (fit.kind === "linear") {
    const surface = linearAnalysisModel.predict(fit.model);
    const points = surface.evaluate(dense);
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
  if (state.ciMethod === "wald") return predictLogisticWaldResult(fit.model, dense);
  return bootstrapLogisticCI(xs, ys, dense, {
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
 * The lines actually drawn on a chart: `computeReferenceLines`'s split cut points, plus a Min and
 * Max line at the same (non-placebo) population's exposure extremes - mirroring the author's
 * original R function's output. Deliberately kept separate from `computeReferenceLines` itself,
 * since that function's cut points also double as the *bin boundaries* for
 * `computeSplitAnnotations`/`computeObservedResponseBins`/`computeObservedMeanBins` - Min/Max
 * would be meaningless (and would silently double-count bins) there, but are exactly what a
 * caller building a chart's `referenceLines` prop wants.
 */
function computeDisplayReferenceLines(metric: ExposureMetric): ReferenceLine[] {
  const splits = computeReferenceLines(metric);
  if (!splits.length) return splits;
  const values = RECORDS.filter((r) => r.dose !== "Placebo")
    .map((r) => exposureValue(r, metric))
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

/**
 * The continuous-endpoint counterpart of `computeObservedResponseBins`: instead of a responder
 * rate + Wilson CI per exposure-split bin, this reports the raw observed mean response + 95% CI
 * (`meanConfidenceInterval`) - there is no responder/non-responder concept for BRLS/PRLS.
 */
function computeObservedMeanBins(metric: ExposureMetric, endpoint: Endpoint): ObservedMeanBin[] {
  if (!state.showObservedResponders || !state.referenceLineKind) return [];
  const cutpoints = computeReferenceLines(metric).map((r) => r.value);
  if (!cutpoints.length) return [];

  const bins: ObservedMeanBin[] = [];

  const withEndpoint = recordsWithEndpoint(endpoint);
  const placeboRows = withEndpoint.filter((r) => r.dose === "Placebo");
  if (placeboRows.length) {
    const mci = meanConfidenceInterval(placeboRows.map((r) => endpointValue(r, endpoint)));
    bins.push({ x: 0, mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n });
  }

  const dosedRows = withEndpoint.filter((r) => r.dose !== "Placebo");
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
    const mci = meanConfidenceInterval(rows.map((r) => endpointValue(r, endpoint)));
    const meanX = rows.reduce((sum, r) => sum + exposureValue(r, metric), 0) / rows.length;
    bins.push({ x: meanX, mean: mci.mean, ciLower: mci.lower, ciUpper: mci.upper, n: mci.n });
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
  const active = activeSet();

  scatterPanelsEl.innerHTML = "";
  distributionPanels = [];

  // "Compare endpoints" overlays every selected endpoint's curve on the same response axis, so
  // it's only meaningful when they all share the same scale - either every selected endpoint is
  // a binary responder outcome (probability axis) or every one is a continuous rating scale
  // (though even then, two different continuous endpoints, e.g. BRLS and PRLS, generally sit on
  // different scales - this restriction just avoids ever mixing a [0,1] probability curve with a
  // rating-scale curve in the same panel). Any number of exposure metrics is fine - each gets its
  // own overlaid "(all)" column.
  const comparisonEligible = endpoints.length > 1 && endpoints.every((e) => !isContinuousEndpoint(e));
  compareEndpointsEl.disabled = !comparisonEligible;

  if (state.compareEndpoints && comparisonEligible) {
    renderEndpointComparisonRow(metrics, endpoints, active);
    endpointLegendEl.style.display = "flex";
    legendEl.style.display = "none";
  } else {
    legendEl.style.display = "flex";
    // one row per endpoint, one column per exposure metric - mirrors facet_grid(Endpoint~expname)
    for (const endpoint of endpoints) {
      const rowEl = document.createElement("div");
      rowEl.className = "endpoint-row";
      const rowGrid = document.createElement("div");
      rowGrid.className = "panel-grid";
      // No separate row-label pill here - each panel's own y-axis (rendered by
      // renderScatterPanel) already carries the endpoint name, so a pill would just repeat it
      // and eat vertical space for no new information.
      rowEl.appendChild(rowGrid);
      scatterPanelsEl.appendChild(rowEl);
      for (const metric of metrics) {
        renderScatterPanel(metric, endpoint, active, rowGrid);
      }
    }
    endpointLegendEl.style.display = "none";

    // The exposure-by-dose distribution doesn't depend on endpoint (dose exposure is the same
    // regardless of which response endpoint you're looking at), so it's shown once per exposure
    // metric - not once per endpoint row - right after all the endpoint rows above, using the
    // primary (first-selected) endpoint for its "n=60 (40 resp.)" responder-count text.
    const primaryEndpoint = endpoints[0] ?? "icgi";
    const sharedRow = document.createElement("div");
    sharedRow.className = "endpoint-row";
    const sharedGrid = document.createElement("div");
    sharedGrid.className = "panel-grid";
    sharedRow.appendChild(sharedGrid);
    scatterPanelsEl.appendChild(sharedRow);
    for (const metric of metrics) {
      const cell = document.createElement("div");
      cell.className = "panel-cell dist-shared";
      sharedGrid.appendChild(cell);
      appendDistributionMini(cell, metric, primaryEndpoint, active, panelWidth(), undefined, endpoints);
    }
  }

  renderLegend();
  updateStatus(active.size);
  updateKpis(active.size, endpoints);
  refLineNoteEl.style.display = state.referenceLineKind ? "block" : "none";
  // the two split annotations only mean anything once a reference-line split is chosen
  splitAnnotationModeEl.disabled = !state.referenceLineKind;
  showObservedRespEl.disabled = !state.referenceLineKind;
  showReferenceFitEl.disabled = !state.referenceLineKind;
  showSplitValueEl.disabled = !state.referenceLineKind;
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
  const groupStats: Record<string, BinaryDoseGroupStats> = {};
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
  return groupStats;
}

/** The clicked-dose projection for a binary endpoint's chart, built from `computeBinaryDoseGroupStats` -
 * shared by both `renderScatterPanel` and `renderEndpointComparisonRow`. Each projected group is
 * colored by dose by default (the regular per-endpoint grid, where dose is the meaningful
 * distinction on that single curve); `colorOverride` lets "Compare endpoints" mode color every
 * dose's projection by the endpoint's own color instead, so the projection reads as "this curve's
 * highlight" rather than blending into the dose-colored points/legend of a different endpoint. */
function projectedGroupsFor(groupStats: Record<string, BinaryDoseGroupStats>, colorOverride?: string): ProjectedGroup[] {
  return [...state.selectedDoses]
    .filter((dose) => groupStats[dose])
    .map((dose) => {
      const { observed, ...rest } = groupStats[dose]!;
      return {
        groupId: dose,
        color: colorOverride ?? DOSE_COLORS[dose] ?? "#111827",
        ...rest,
        observed: state.showDoseObserved ? observed : undefined
      };
    });
}

function renderScatterPanel(
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  container: HTMLElement
): void {
  const { fit, xs, ys } = fitFor(metric, endpoint);
  const xMax = Math.max(...xs);
  const curve = curveFor(fit, xs, ys, xMax);
  const continuous = isContinuousEndpoint(endpoint);

  const points: ScatterPoint[] = recordsWithEndpoint(endpoint).map((r) => ({
    id: r.id,
    exposure: exposureValue(r, metric),
    response: endpointValue(r, endpoint),
    // binary responses (0/1) get a small vertical jitter so overlapping points are visible; a
    // continuous rating-scale response is plotted at its own actual value.
    displayY: continuous ? endpointValue(r, endpoint) : endpointValue(r, endpoint) + seededJitter(r.id),
    groupId: r.dose,
    label: `${exposureLabel(metric)} ${exposureValue(r, metric).toFixed(1)} · ${endpoint.toUpperCase()} ${endpointValue(r, endpoint)} · ${r.dose} · Study ${r.study}`,
    selected: active.has(r.id)
  }));

  const width = panelWidth();
  let scatterResult: { content: string; metadata: Record<string, unknown> };

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
    for (const dose of DOSE_ORDER) {
      const doseRecords = recordsWithEndpoint(endpoint).filter((r) => active.has(r.id) && r.dose === dose);
      const vals = doseRecords.map((r) => exposureValue(r, metric)).sort((a, b) => a - b);
      if (!vals.length) continue;
      const s = summarizeDistribution(vals);
      if (!s) continue;
      const mci = meanConfidenceInterval(doseRecords.map((r) => endpointValue(r, endpoint)));
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
          color: DOSE_COLORS[dose] ?? "#111827",
          ...rest,
          observedMean: state.showDoseObserved ? observedMean : undefined
        };
      });

    scatterResult = renderLinearScatterChart({
      points: state.showPoints ? points : [],
      curve,
      projected,
      groupColors: DOSE_COLORS,
      xDomain: [0, xMax],
      referenceLines: computeDisplayReferenceLines(metric),
      observedMeanBins: computeObservedMeanBins(metric, endpoint),
      showReferenceFit: state.showReferenceFit,
      showSplitValue: state.showSplitValue,
      width,
      height: 360,
      options: { title: "Exposure vs response", xAxisLabel: exposureLabel(metric), yAxisLabel: endpoint.toUpperCase(), renderTarget: "svg" }
    });
  } else {
    const groupStats = computeBinaryDoseGroupStats(metric, endpoint, active);
    const projected = projectedGroupsFor(groupStats);

    scatterResult = renderLogisticScatterChart({
      points: state.showPoints ? points : [],
      curve,
      projected,
      groupColors: DOSE_COLORS,
      xDomain: [0, xMax],
      referenceLines: computeDisplayReferenceLines(metric),
      observedBins: computeObservedResponseBins(metric, endpoint),
      showReferenceFit: state.showReferenceFit,
      showSplitValue: state.showSplitValue,
      width,
      height: 360,
      options: { title: "Exposure vs response", xAxisLabel: exposureLabel(metric), yAxisLabel: endpoint.toUpperCase(), renderTarget: "svg" }
    });
  }

  const cell = document.createElement("div");
  cell.className = "panel-cell";
  // No panel-cell-title here - the chart's own x/y axis labels (exposure metric, endpoint) already
  // carry this information, so a repeated text title above it would just add whitespace.
  cell.innerHTML = `<div class="chart" data-metric="${metric}"></div>`;
  container.appendChild(cell);
  const chartWrap = cell.querySelector(".chart") as HTMLDivElement;
  chartWrap.innerHTML = scatterResult.content;
  const tip = document.createElement("div");
  tip.className = "tooltip";
  chartWrap.appendChild(tip);
  attachScatterInteractivity(chartWrap, tip, metric, endpoint, scatterResult.metadata as unknown as ScatterMeta);
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
function appendDistributionMini(
  cell: HTMLElement,
  metric: ExposureMetric,
  endpoint: Endpoint,
  active: Set<number>,
  width: number,
  splitByEndpoints?: Endpoint[],
  // Which endpoints' fit values to show in the dose-click readout below the chart - independent
  // of `splitByEndpoints` (which controls whether the boxplot/lineranges rows themselves are
  // split per endpoint). The regular per-endpoint-row view never splits the shared distribution
  // rows (exposure doesn't depend on endpoint), but with 2+ endpoints selected its readout is
  // just as ambiguous as Compare endpoints' was - so this lets the caller pass every selected
  // endpoint here even when `splitByEndpoints` is omitted.
  readoutEndpoints?: Endpoint[]
): void {
  const xs = RECORDS.map((r) => exposureValue(r, metric));
  const xMax = Math.max(...xs);
  const xDomain: [number, number] = [0, xMax];

  let distGroups: DistributionGroupInput[];

  if (splitByEndpoints && splitByEndpoints.length > 1) {
    distGroups = DOSE_ORDER.slice()
      .reverse()
      .flatMap((dose) => {
        const isPlacebo = dose === "Placebo";
        const rows = RECORDS.filter((r) => r.dose === dose);
        if (!rows.length) return [];
        const values = isPlacebo ? [] : rows.map((r) => exposureValue(r, metric));
        return splitByEndpoints.map((ep, i) => ({
          groupId: dose,
          label: i === 0 ? dose : "",
          color: ENDPOINT_COLORS[ep],
          values,
          n: rows.length,
          // per-dose responder counts used to be shown here ("n=60 (40 resp.)"), but that
          // observed %/N is already available (and unambiguous, since it's for one clicked dose
          // at a time) by clicking the box/row above - see showDoseObserved.
          selected: state.selectedDoses.has(dose),
          skipShape: isPlacebo,
          splitAnnotations:
            !isPlacebo && state.splitAnnotationMode !== "off"
              ? computeSplitAnnotations(metric, dose, xDomain, state.splitAnnotationMode)
              : undefined
        }));
      });
  } else {
    distGroups = DOSE_ORDER.slice()
      .reverse()
      .map((dose) => {
        const isPlacebo = dose === "Placebo";
        const rows = RECORDS.filter((r) => r.dose === dose);
        const values = isPlacebo ? [] : rows.map((r) => exposureValue(r, metric));
        return {
          groupId: dose,
          label: dose,
          color: DOSE_COLORS[dose],
          values,
          n: rows.length,
          // Deliberately no responder count here: this shared strip is shown once per exposure
          // metric regardless of how many endpoints are selected, so a responder count here
          // could only ever reflect one of them - misleadingly silent about the rest. That
          // per-dose observed %/N is still available, unambiguously, by clicking the row (see
          // showDoseObserved) which reports it for whichever endpoint panel it's clicked under.
          selected: state.selectedDoses.has(dose),
          skipShape: isPlacebo,
          splitAnnotations:
            isPlacebo || state.splitAnnotationMode === "off" ? undefined : computeSplitAnnotations(metric, dose, xDomain, state.splitAnnotationMode)
        };
      })
      .filter((g) => g.n > 0);
  }

  // Panel height is always based on the plain 5-dose count, regardless of whether this is the
  // regular view or the "Compare endpoints" split-by-endpoint view - so the panel is visually the
  // same size in both places. When split into per-endpoint sub-rows there are more (denser) rows
  // to fit in that same height; renderDistributionChart's own band = plot.height / groups.length
  // shrinks each row proportionally to fit, rather than growing the panel taller.
  const doseCount = DOSE_ORDER.filter((dose) => RECORDS.some((r) => r.dose === dose)).length;
  const height = Math.max(200, doseCount * 26 + 60);

  const distResult = renderDistributionChart({
    groups: distGroups,
    xDomain: [0, xMax],
    mode: state.distributionMode,
    referenceLines: computeDisplayReferenceLines(metric),
    width,
    height,
    options: { title: "Exposure by dose", xAxisLabel: exposureLabel(metric), yAxisLabel: "", renderTarget: "svg" }
  });

  const wrap = document.createElement("div");
  wrap.className = "dist-inline";
  wrap.innerHTML = `<div class="dist-inline-label">Exposure distribution by dose</div><div class="chart dist-inline-chart" style="height: ${height}px;"></div><div class="readout"><span class="muted">Click a row above to show projected fit values at Min, Q1, Median, Q3, and Max.</span></div>`;
  cell.appendChild(wrap);
  const chartWrap = wrap.querySelector(".chart") as HTMLDivElement;
  const readoutEl = wrap.querySelector(".readout") as HTMLDivElement;
  chartWrap.innerHTML = distResult.content;
  const finalReadoutEndpoints = readoutEndpoints ?? (splitByEndpoints && splitByEndpoints.length > 1 ? splitByEndpoints : [endpoint]);
  attachDistributionInteractivity(chartWrap, metric, finalReadoutEndpoints, active, readoutEl, distResult.metadata as unknown as DistributionMeta);
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
function renderEndpointComparisonRow(metrics: ExposureMetric[], endpoints: Endpoint[], active: Set<number>): void {
  renderEndpointLegend(endpoints);

  const chartHeight = 360;
  const width = panelWidth();

  const rowEl = document.createElement("div");
  rowEl.className = "endpoint-row";
  const rowGrid = document.createElement("div");
  rowGrid.className = "panel-grid";
  rowEl.appendChild(rowGrid);
  scatterPanelsEl.appendChild(rowEl);

  // Only the combined "(all)" overlay is ever shown here - one column per selected exposure
  // metric, mirroring the regular grid's one-column-per-metric layout. Individual per-endpoint
  // panels (and the "Only show (all)" toggle that used to switch between the two) were dropped:
  // with 2+ exposure metrics they'd multiply into a full endpoints x metrics grid, defeating the
  // point of a compact side-by-side comparison, so the overlay is simply always the view.
  for (const metric of metrics) {
    const xMax = Math.max(...RECORDS.map((r) => exposureValue(r, metric)));
    const referenceLines = computeDisplayReferenceLines(metric);

    // Raw jittered points, colored by endpoint instead of dose (gated by the shared "Show
    // points" toggle) - one set per endpoint, all overlaid together in this metric's panel.
    const pointsFor = (endpoint: Endpoint): ScatterPoint[] =>
      RECORDS.map((r) => ({
        id: r.id,
        exposure: exposureValue(r, metric),
        response: endpointValue(r, endpoint),
        displayY: endpointValue(r, endpoint) + seededJitter(r.id),
        groupId: endpoint,
        label: `${exposureLabel(metric)} ${exposureValue(r, metric).toFixed(1)} · ${endpoint.toUpperCase()} ${endpointValue(r, endpoint)} · ${r.dose} · Study ${r.study}`,
        selected: active.has(r.id)
      }));

    const fits = endpoints.map((endpoint) => {
      // this comparison view is only ever reached with binary (logistic) endpoints - see
      // comparisonEligible in render(), which excludes any continuous (linear) endpoint.
      const { fit, xs, ys } = fitFor(metric, endpoint);
      const curve = curveFor(fit, xs, ys, xMax);
      const observedBins: ObservedResponseBin[] = computeObservedResponseBins(metric, endpoint).map((b) => ({
        ...b,
        color: ENDPOINT_COLORS[endpoint]
      }));
      // Each endpoint gets its own dose-click projection, drawn against its own curve and colored
      // by that endpoint (not by dose) - so clicking a dose row highlights every overlaid
      // endpoint's curve at once, each in its own color, instead of only the primary endpoint's.
      const groupStats = computeBinaryDoseGroupStats(metric, endpoint, active);
      const projected = projectedGroupsFor(groupStats, ENDPOINT_COLORS[endpoint]);
      return { endpoint, curve, observedBins, projected };
    });

    const [first, ...rest] = fits;
    if (!first) continue;

    const extraCurves: ExtraCurve[] = rest.map((f) => ({
      curve: f.curve,
      color: ENDPOINT_COLORS[f.endpoint],
      dash: ENDPOINT_DASH[f.endpoint],
      projected: f.projected
    }));
    const allObservedBins = fits.flatMap((f) => f.observedBins);
    const allPoints = state.showPoints ? fits.flatMap((f) => pointsFor(f.endpoint)) : [];
    const allGroupColors = Object.fromEntries(fits.map((f) => [f.endpoint, ENDPOINT_COLORS[f.endpoint]]));
    const result = renderLogisticScatterChart({
      points: allPoints,
      curve: first.curve,
      projected: first.projected,
      groupColors: allGroupColors,
      xDomain: [0, xMax],
      referenceLines,
      observedBins: allObservedBins,
      showReferenceFit: state.showReferenceFit,
      showSplitValue: state.showSplitValue,
      curveColor: ENDPOINT_COLORS[first.endpoint],
      curveDash: ENDPOINT_DASH[first.endpoint],
      bandColor: ENDPOINT_COLORS[first.endpoint],
      extraCurves,
      width,
      height: chartHeight,
      options: { title: "x", xAxisLabel: exposureLabel(metric), yAxisLabel: "Response", renderTarget: "svg" }
    });

    // Deliberately no attachScatterInteractivity here (unlike the regular grid): its brush-select
    // math resolves a drag rectangle to patient ids via a single endpoint's response value, which
    // would be wrong for points drawn from several different endpoints overlaid at once. Hover
    // tooltips read each point's own data-* attributes already baked into the SVG, so those would
    // be accurate, but brushing isn't - simplest to leave both off here rather than ship a
    // half-correct interaction.
    const cell = document.createElement("div");
    cell.className = "panel-cell";
    cell.innerHTML = `<div class="panel-cell-title">${exposureLabel(metric)}</div><div class="chart" data-metric="${metric}" style="height: ${chartHeight}px;"></div>`;
    rowGrid.appendChild(cell);
    (cell.querySelector(".chart") as HTMLDivElement).innerHTML = result.content;
  }

  // The exposure-by-dose distribution (Boxplot / Distribution / Lineranges - the same toggle used
  // in the regular view) doesn't depend on which endpoint's curve it's being compared against, so
  // it's shown once per exposure metric, shared beneath the overlay panel above (not duplicated
  // per endpoint). Split into one sub-row per endpoint (colored by endpoint, clustered by dose)
  // so the per-endpoint coloring this view is built around isn't lost just because the panel
  // itself is shared/unduplicated.
  const distRowEl = document.createElement("div");
  distRowEl.className = "endpoint-row";
  const distGrid = document.createElement("div");
  distGrid.className = "panel-grid";
  distRowEl.appendChild(distGrid);
  scatterPanelsEl.appendChild(distRowEl);
  for (const metric of metrics) {
    const distCell = document.createElement("div");
    distCell.className = "panel-cell dist-shared";
    distGrid.appendChild(distCell);
    appendDistributionMini(distCell, metric, endpoints[0], active, panelWidth(), endpoints);
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

/** Whether the currently-rendered view is the endpoint-comparison overlay (curves colored by
 * endpoint, not dose) - mirrors the same eligibility check used in render()/
 * renderEndpointComparisonRow. Used to avoid coloring dose names by DOSE_COLORS in text that sits
 * near that view, since a dose no longer maps to a single color there (it's split by endpoint). */
function isEndpointComparisonActive(): boolean {
  const endpoints = selectedEndpoints();
  // Mirrors comparisonEligible in render() - Compare endpoints now works with any number of
  // exposure metrics (each gets its own overlaid "(all)" column), so this must not require
  // exactly one metric to be selected the way it used to before that redesign.
  return state.compareEndpoints && endpoints.length > 1 && endpoints.every((e) => !isContinuousEndpoint(e));
}

function doseColorFor(dose: string): string {
  return isEndpointComparisonActive() ? "#334155" : DOSE_COLORS[dose] ?? "#111827";
}

function updateStatus(activeCount: number): void {
  const total = RECORDS.length;
  // color each dose name to match its swatch/marker color, so it's easy to tell which
  // highlighted dose is which at a glance, consistent with the rest of the UI - except in
  // Compare Endpoints mode, where a dose no longer has one color (see doseColorFor).
  const doseNamesHtml = [...state.selectedDoses]
    .map((dose) => `<strong style="color:${doseColorFor(dose)}">${dose}</strong>`)
    .join(", ");
  const focusHtml = state.selectedDoses.size ? `dose = ${doseNamesHtml}` : "";
  const brushText = state.brushedIds ? `${state.brushedIds.size} brushed` : "";
  if (!state.brushedIds && !state.selectedDoses.size) {
    statusEl.textContent = "Showing all rows";
  } else {
    statusEl.innerHTML = [brushText, focusHtml].filter(Boolean).join(" and ") + ` (${activeCount} of ${total} rows)`;
  }
}

/** Renders one row per selected endpoint in the top "Responders by endpoint" card, each split
 * into Placebo vs Dosed (all non-placebo patients pooled) - a single pooled rate across every
 * dose would blend a very different baseline (Placebo) into the treated-population rate, and
 * previously this card only ever reflected one endpoint even when several were selected. */
function updateKpis(activeCount: number, endpoints: Endpoint[]): void {
  kpiN.textContent = String(RECORDS.length);
  kpiShowing.textContent = String(activeCount);

  const placeboRecords = RECORDS.filter((r) => r.dose === "Placebo");
  const dosedRecords = RECORDS.filter((r) => r.dose !== "Placebo");
  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  kpiRespondersBody.innerHTML = endpoints
    .map((endpoint) => {
      // A continuous endpoint (BRLS/PRLS) has no responder/non-responder concept - this row
      // reports the observed mean response + 95% CI + n contributing instead of a % responders.
      if (isContinuousEndpoint(endpoint)) {
        const hasValue = (r: ExposureResponseRecord) => Number.isFinite(endpointValue(r, endpoint));
        const placeboMci = meanConfidenceInterval(placeboRecords.filter(hasValue).map((r) => endpointValue(r, endpoint)));
        const dosedMci = meanConfidenceInterval(dosedRecords.filter(hasValue).map((r) => endpointValue(r, endpoint)));
        const fmt = (m: { mean: number; lower: number; upper: number }) => `${m.mean.toFixed(1)} [${m.lower.toFixed(1)}-${m.upper.toFixed(1)}]`;
        return `<div class="responder-row">
          <span class="responder-endpoint">${endpoint.toUpperCase()}</span>
          <span class="responder-group"><span class="muted">Placebo</span> <strong>${fmt(placeboMci)}</strong> <span class="muted">(n=${placeboMci.n})</span></span>
          <span class="responder-group"><span class="muted">Dosed</span> <strong>${fmt(dosedMci)}</strong> <span class="muted">(n=${dosedMci.n})</span></span>
        </div>`;
      }
      const placeboResponders = placeboRecords.filter((r) => endpointValue(r, endpoint) === 1).length;
      const dosedResponders = dosedRecords.filter((r) => endpointValue(r, endpoint) === 1).length;
      return `<div class="responder-row">
        <span class="responder-endpoint">${endpoint.toUpperCase()}</span>
        <span class="responder-group"><span class="muted">Placebo</span> <strong>${pct(placeboResponders, placeboRecords.length)}%</strong> <span class="muted">(${placeboResponders}/${placeboRecords.length})</span></span>
        <span class="responder-group"><span class="muted">Dosed</span> <strong>${pct(dosedResponders, dosedRecords.length)}%</strong> <span class="muted">(${dosedResponders}/${dosedRecords.length})</span></span>
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
function updateReadout(readoutEl: HTMLDivElement, metric: ExposureMetric, endpoints: Endpoint[], active: Set<number>): void {
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
  const multiEndpoint = endpoints.length > 1;
  const colorByEndpoint = isEndpointComparisonActive();
  const lines: string[] = [];
  for (const dose of doses) {
    const g = groupStats[dose];
    for (const endpoint of endpoints) {
      const { fit } = fitFor(metric, endpoint);
      const continuous = isContinuousEndpoint(endpoint);
      const decimals = continuous ? 1 : 3;
      const fitAt = (x: number) =>
        fit.kind === "linear" ? fit.model.intercept + fit.model.slope * x : 1 / (1 + Math.exp(-(fit.model.intercept + fit.model.slope * x)));
      const color = colorByEndpoint ? ENDPOINT_COLORS[endpoint] : doseColorFor(dose);
      const label = multiEndpoint ? `${dose} · ${endpoint.toUpperCase()}` : dose;
      lines.push(
        `<div><strong style="color:${color}">${label}</strong> &nbsp; Min ${exposureLabel(metric)} = ${g.min.toFixed(1)} (fit ${fitAt(g.min).toFixed(decimals)}) &nbsp; Q1 = ${g.q1.toFixed(1)} (fit ${fitAt(g.q1).toFixed(decimals)}) &nbsp; Median = ${g.median.toFixed(1)} (fit ${fitAt(g.median).toFixed(decimals)}) &nbsp; Q3 = ${g.q3.toFixed(1)} (fit ${fitAt(g.q3).toFixed(decimals)}) &nbsp; Max = ${g.max.toFixed(1)} (fit ${fitAt(g.max).toFixed(decimals)})</div>`
      );
    }
  }
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
    const continuous = isContinuousEndpoint(endpoint);
    const selected = RECORDS.filter((r) => {
      const ex = exposureValue(r, metric);
      // matches how points are actually plotted in renderScatterPanel: a continuous response is
      // shown at its own value (no jitter); a missing continuous response (NaN) never satisfies
      // this range check, so those rows are simply never brushable, matching that they're never
      // drawn as a point either.
      const disp = continuous ? endpointValue(r, endpoint) : endpointValue(r, endpoint) + seededJitter(r.id);
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
  endpoints: Endpoint[],
  active: Set<number>,
  readoutEl: HTMLDivElement,
  meta: DistributionMeta
): void {
  const svg = chartWrap.querySelector("svg");
  updateReadout(readoutEl, metric, endpoints, active);
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
 * Session save / load
 * ---------------------------------------------------------------------- */

function buildSessionState(): SessionState {
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
  const xMax = Math.max(...xs);
  const curve = curveFor(fit, xs, ys, xMax);
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
      showSplitValue: state.showSplitValue,
      showDoseObserved: state.showDoseObserved,
      compareEndpoints: state.compareEndpoints,
      showPoints: state.showPoints
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
      const isKnownEndpoint = (e: unknown): e is Endpoint => e === "icgi" || e === "icgi2" || e === "icgi3" || e === "brls" || e === "prls";
      if (Array.isArray(endpointsRaw)) {
        endpoints = endpointsRaw.filter(isKnownEndpoint);
      } else if (isKnownEndpoint(legacyEndpoint)) {
        endpoints = [legacyEndpoint];
      }
      if (!endpoints.length) endpoints = ["icgi"];
      state.endpoints = new Set(endpoints);

      if (ci === "wald" || ci === "bootstrap") state.ciMethod = ci;
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
      state.showSplitValue = session.settings["showSplitValue"] === true;
      // default true (matches the app's default) so older session files without this key still
      // show the dose-observed marker rather than silently hiding it
      state.showDoseObserved = session.settings["showDoseObserved"] !== false;
      state.compareEndpoints = session.settings["compareEndpoints"] === true;
      state.showPoints = session.settings["showPoints"] !== false;
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
      showSplitValueEl.checked = state.showSplitValue;
      showDoseObservedEl.checked = state.showDoseObserved;
      compareEndpointsEl.checked = state.compareEndpoints;
      showPointsEl.checked = state.showPoints;
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
showSplitValueEl.addEventListener("change", () => {
  state.showSplitValue = showSplitValueEl.checked;
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

showPointsEl.addEventListener("change", () => {
  state.showPoints = showPointsEl.checked;
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

// panel descriptive text is collapsed by default (it's useful but takes real vertical space) -
// each "Show details" button just toggles its own associated note element, independent of any
// app state, so this wiring is a plain DOM behavior rather than something round-tripped through
// render().
document.querySelectorAll<HTMLButtonElement>(".note-toggle").forEach((btn) => {
  const targetId = btn.dataset.target;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) return;
  btn.addEventListener("click", () => {
    const isHidden = target.style.display === "none";
    target.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "Hide details ▴" : "Show details ▾";
    btn.setAttribute("aria-expanded", String(isHidden));
  });
});

render();
