import { describe, expect, it } from "vitest";
import type { ConfidenceInterval } from "./confidenceInterval";
import type { PredictionSurface, PredictionSurfacePoint } from "./predictionSurface";
import { sampleCurve } from "./sampleCurve";

function fakeSurface(estimateAt: (exposure: number, endpointId?: string) => number): PredictionSurface {
  return {
    analysisModelId: "fake-model",
    scale: "response",
    evaluate(exposures: number[]): PredictionSurfacePoint[] {
      return exposures.map((exposure) => ({ exposure, estimate: estimateAt(exposure) }));
    }
  };
}

describe("sampleCurve", () => {
  it("merges a PredictionSurface's estimates with matching ConfidenceIntervals by exposure", () => {
    const surface = fakeSurface((e) => e / 100);
    const cis: ConfidenceInterval[] = [
      { exposure: 0, method: "wald", level: 0.95, lower: 0, upper: 0.1 },
      { exposure: 50, method: "wald", level: 0.95, lower: 0.4, upper: 0.6 },
      { exposure: 100, method: "wald", level: 0.95, lower: 0.85, upper: 1 }
    ];

    const result = sampleCurve(surface, { confidenceIntervals: cis });

    expect(result).toEqual([
      { exposure: 0, estimate: 0, lower: 0, upper: 0.1, endpointId: undefined },
      { exposure: 50, estimate: 0.5, lower: 0.4, upper: 0.6, endpointId: undefined },
      { exposure: 100, estimate: 1, lower: 0.85, upper: 1, endpointId: undefined }
    ]);
  });

  it("uses explicit `exposures` as the sampling grid when supplied, independent of CI exposures", () => {
    const surface = fakeSurface((e) => e / 10);
    const result = sampleCurve(surface, { exposures: [0, 5, 10] });
    expect(result.map((p) => p.exposure)).toEqual([0, 5, 10]);
    expect(result.every((p) => Number.isNaN(p.lower) && Number.isNaN(p.upper))).toBe(true);
  });

  it("returns an empty array when neither exposures nor confidenceIntervals are supplied", () => {
    const surface = fakeSurface(() => 0);
    expect(sampleCurve(surface)).toEqual([]);
  });

  it("keys the merge by (exposure, endpointId), not exposure alone, for multi-endpoint surfaces", () => {
    const surface: PredictionSurface = {
      analysisModelId: "fake-model",
      scale: "response",
      evaluate: (exposures) =>
        exposures.flatMap((exposure) => [
          { exposure, estimate: 0.3, endpointId: "icgi" },
          { exposure, estimate: 0.7, endpointId: "icgi2" }
        ])
    };
    const cis: ConfidenceInterval[] = [
      { exposure: 50, method: "wald", level: 0.95, lower: 0.2, upper: 0.4, endpointId: "icgi" },
      { exposure: 50, method: "wald", level: 0.95, lower: 0.6, upper: 0.8, endpointId: "icgi2" }
    ];

    const result = sampleCurve(surface, { confidenceIntervals: cis });

    expect(result).toEqual([
      { exposure: 50, estimate: 0.3, lower: 0.2, upper: 0.4, endpointId: "icgi" },
      { exposure: 50, estimate: 0.7, lower: 0.6, upper: 0.8, endpointId: "icgi2" }
    ]);
  });

  it("leaves lower/upper as NaN for an exposure with no matching ConfidenceInterval", () => {
    const surface = fakeSurface((e) => e / 100);
    const cis: ConfidenceInterval[] = [{ exposure: 50, method: "wald", level: 0.95, lower: 0.4, upper: 0.6 }];
    const result = sampleCurve(surface, { exposures: [0, 50], confidenceIntervals: cis });
    expect(Number.isNaN(result[0].lower)).toBe(true);
    expect(result[1].lower).toBe(0.4);
  });
});
