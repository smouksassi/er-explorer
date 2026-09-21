import type { DatasetContext, EndpointId } from "./datasetContext";
import type { PredictionResult } from "@er-explorer/analysis";

export type EndpointAnalysisModel = "logistic" | "linear" | "loess" | "emax" | "gam";

/**
 * Which families a given endpoint DATA KIND may be fit with — the single
 * declaration behind both the Endpoint Models option list and `fitForCohort`'s
 * defensive fall-through. Eligibility is a declared property of the family,
 * not a chain of conditionals at each use site.
 *
 * The two asymmetries are scientific, not incidental:
 * - **"loess" is continuous-only.** An unconstrained local regression has no
 *   mechanism to respect [0,1]; on real icgi/AUC subgroups the POINT ESTIMATE
 *   reaches 1.07 and CI floors reach −0.11. Fine on a continuous scale, wrong
 *   for a probability. Replaced on binary by "gam".
 * - **"gam" is binary-only**, and **"emax" continuous-only.** The GAM smooths
 *   on the logit scale, which only means something for a binomial response;
 *   Emax is a nonlinear continuous-response curve, and nesting it inside a
 *   logit link needs far more data than is typically available (parked — see
 *   `.ai/CONTINUE_HERE.md`).
 *
 * Order here is the order the select renders.
 */
export const MODELS_BY_DATA_KIND: Record<"binary" | "continuous", readonly EndpointAnalysisModel[]> = {
  binary: ["logistic", "gam"],
  continuous: ["linear", "loess", "emax"]
};

export const MODEL_LABELS: Record<EndpointAnalysisModel, string> = {
  logistic: "Logistic",
  linear: "Linear",
  loess: "Loess",
  emax: "Emax",
  gam: "GAM (spline)"
};

/**
 * The DATA KIND of an endpoint (binary responder vs continuous scale) — decides
 * the painter path (jitter, probability axis, x/N vs mean±CI observed
 * summaries) independently of which MODEL fits the curve (ADR-0013: the
 * observed layer stays endpoint-TYPE driven, so a binary endpoint reads as
 * x/N proportions whether it is fit by Logistic or by GAM).
 *
 * Which models are *offered* for a data kind is a separate question — see
 * {@link MODELS_BY_DATA_KIND}.
 */
export function endpointDataKind(ds: DatasetContext, endpoint: EndpointId): "binary" | "continuous" {
  return inferDefaultEndpointModel(ds, endpoint) === "logistic" ? "binary" : "continuous";
}

export interface EndpointNormScale {
  min: number;
  max: number;
  /** When false, min/max track observed data range until user edits. */
  useCustomBounds: boolean;
}

export function endpointNumericValues(ds: DatasetContext, endpoint: EndpointId): number[] {
  return ds
    .rowIndicesWithEndpoint(endpoint)
    .map((i) => ds.endpointValue(i, endpoint))
    .filter((v) => Number.isFinite(v));
}

export function dataRangeForEndpoint(ds: DatasetContext, endpoint: EndpointId): { min: number; max: number } | null {
  const vals = endpointNumericValues(ds, endpoint);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/** Suggested model when the user has not chosen one yet. */
export function inferDefaultEndpointModel(ds: DatasetContext, endpoint: EndpointId): EndpointAnalysisModel {
  const vals = endpointNumericValues(ds, endpoint);
  if (!vals.length) return "logistic";
  const rounded = vals.map((v) => Math.round(v * 1e6) / 1e6);
  const distinct = new Set(rounded);
  if (distinct.size <= 2 && [...distinct].every((v) => v === 0 || v === 1)) return "logistic";
  const inferred = ds.inferred[endpoint];
  if (inferred?.type === "continuous") return "linear";
  if (distinct.size > 2) return "linear";
  return "logistic";
}

export function defaultNormScale(ds: DatasetContext, endpoint: EndpointId): EndpointNormScale | null {
  const range = dataRangeForEndpoint(ds, endpoint);
  if (!range) return null;
  return { min: range.min, max: range.max, useCustomBounds: false };
}

export function resolveNormBounds(scale: EndpointNormScale | undefined, dataRange: { min: number; max: number } | null): {
  min: number;
  max: number;
  valid: boolean;
} {
  if (!scale || !dataRange) return { min: 0, max: 1, valid: false };
  const min = scale.useCustomBounds ? scale.min : dataRange.min;
  const max = scale.useCustomBounds ? scale.max : dataRange.max;
  return { min, max, valid: max > min };
}

export function normToCompareScale(y: number, min: number, max: number, clamp = true): number {
  if (!Number.isFinite(y) || max <= min) return NaN;
  const t = (y - min) / (max - min);
  if (!clamp) return t;
  return Math.max(0, Math.min(1, t));
}

export function mapCurveToCompareScale(curve: PredictionResult, min: number, max: number): PredictionResult {
  const map = (v: number) => normToCompareScale(v, min, max);
  return {
    ...curve,
    estimates: curve.estimates.map((e) => ({
      exposure: e.exposure,
      estimate: map(e.estimate),
      lower: Number.isFinite(e.lower) ? map(e.lower) : NaN,
      upper: Number.isFinite(e.upper) ? map(e.upper) : NaN
    })),
    metadata: curve.metadata
  };
}
