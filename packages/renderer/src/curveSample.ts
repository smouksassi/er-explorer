import type { PredictionPoint } from "@er-explorer/domain";

/**
 * The renderer's curve input type - a plain alias of `@er-explorer/domain`'s `PredictionPoint`,
 * not a new nominal type (docs/RENDERER_ARCHITECTURE.md sections 1-2). The same shape a
 * persisted, session-replayed `Prediction.points` already uses (ADR-0004), so a live-sampled
 * curve and a replayed session converge on one render path.
 *
 * Reconciling a live `AnalysisModel`'s `PredictionSurface` (point estimates only - deliberately
 * no CI) with its `confidenceInterval()` output (a separate concept, so several CI methods can
 * be requested/compared) into a `CurveSample[]` is `@er-explorer/analysis`'s `sampleCurve()`
 * helper, not this package's job - `packages/renderer` never imports `@er-explorer/analysis`.
 */
export type CurveSample = PredictionPoint;

/**
 * Linearly interpolates a `CurveSample[]` (sorted ascending by `exposure`) at an arbitrary
 * exposure - e.g. to read a fitted value + CI at a reference line's cut point for
 * `AnnotationLayer`'s optional marker, or a dose-click projection's Q1/median/Q3 in a later
 * phase. Ported from the current renderer's `interpolateEstimate`/`interpolateFullEstimate`
 * (combined into one function, since `CurveSample.lower`/`.upper` can simply be `NaN` when
 * unavailable rather than needing a separate point-only variant).
 *
 * This is geometry (reading a value off an already-fitted curve's own samples), not a
 * statistical computation - it never touches `@er-explorer/analysis` or refits anything.
 */
export function interpolateCurveSample(samples: CurveSample[], exposure: number): CurveSample {
  if (!samples.length) return { exposure, estimate: NaN, lower: NaN, upper: NaN };

  const first = samples[0];
  if (exposure <= first.exposure) return { ...first, exposure };

  const last = samples[samples.length - 1];
  if (exposure >= last.exposure) return { ...last, exposure };

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (exposure >= a.exposure && exposure <= b.exposure) {
      const t = (exposure - a.exposure) / (b.exposure - a.exposure || 1);
      return {
        exposure,
        estimate: a.estimate + t * (b.estimate - a.estimate),
        lower: a.lower + t * (b.lower - a.lower),
        upper: a.upper + t * (b.upper - a.upper),
        endpointId: a.endpointId
      };
    }
  }

  return { ...last, exposure };
}
