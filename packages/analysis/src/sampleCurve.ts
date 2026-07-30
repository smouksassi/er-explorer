import type { PredictionPoint } from "@er-explorer/domain";
import type { ConfidenceInterval } from "./confidenceInterval";
import type { PredictionSurface } from "./predictionSurface";

export interface SampleCurveOptions {
  /**
   * Exposure values to evaluate the surface at. If omitted, derived from `confidenceIntervals`'s
   * own exposures (deduplicated, sorted ascending) - one of the two must supply the sampling
   * grid.
   */
  exposures?: number[];
  /**
   * Confidence intervals to merge in by `(exposure, endpointId)` - typically an
   * `AnalysisModel.confidenceInterval()` call's own output. Omit to produce points with
   * `lower`/`upper` as `NaN` (a `Fit` layer can still render the curve without a
   * `ConfidenceRibbon` layer).
   */
  confidenceIntervals?: ConfidenceInterval[];
}

/**
 * Reconciles a live `AnalysisModel`'s `PredictionSurface` (point estimates only, deliberately no
 * CI - see docs/RENDERER_ARCHITECTURE.md section 1) with its `confidenceInterval()` output (kept
 * as a separate concept so several CI methods can be requested/compared for the same curve) into
 * one `PredictionPoint[]` - the exact shape `@er-explorer/renderer`'s `CurveSample` aliases, and
 * the same shape a persisted, session-replayed `Prediction.points` already uses (ADR-0004).
 *
 * This is alignment, not computation: it merges two already-computed sources by
 * `(exposure, endpointId)`. It never fits a model or derives a confidence interval itself, so it
 * does not reintroduce statistics into the renderer - `packages/renderer` never imports this
 * package; a caller (e.g. `apps/demo`) calls `sampleCurve()` itself and hands the plain
 * `PredictionPoint[]` result to a `FitLayer`/`ConfidenceRibbonLayer`.
 */
export function sampleCurve(surface: PredictionSurface, options: SampleCurveOptions = {}): PredictionPoint[] {
  const confidenceIntervals = options.confidenceIntervals ?? [];
  const exposures = options.exposures ?? dedupeSorted(confidenceIntervals.map((ci) => ci.exposure));
  if (!exposures.length) return [];

  const ciByKey = new Map<string, ConfidenceInterval>();
  for (const ci of confidenceIntervals) {
    ciByKey.set(sampleKey(ci.exposure, ci.endpointId), ci);
  }

  return surface.evaluate(exposures).map((point) => {
    const ci = ciByKey.get(sampleKey(point.exposure, point.endpointId));
    return {
      exposure: point.exposure,
      estimate: point.estimate,
      lower: ci?.lower ?? NaN,
      upper: ci?.upper ?? NaN,
      endpointId: point.endpointId
    };
  });
}

function sampleKey(exposure: number, endpointId?: string): string {
  return `${endpointId ?? ""}:${exposure}`;
}

function dedupeSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}
