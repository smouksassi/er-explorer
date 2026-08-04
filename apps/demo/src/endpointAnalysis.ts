import type { DatasetContext, EndpointId } from "./datasetContext";
import type { PredictionResult } from "@er-explorer/analysis";

export type EndpointAnalysisModel = "logistic" | "linear";

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
