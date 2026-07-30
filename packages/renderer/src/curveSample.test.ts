import { describe, expect, it } from "vitest";
import { interpolateCurveSample } from "./curveSample";
import type { CurveSample } from "./curveSample";

const samples: CurveSample[] = [
  { exposure: 0, estimate: 0, lower: -0.1, upper: 0.1 },
  { exposure: 50, estimate: 0.5, lower: 0.4, upper: 0.6 },
  { exposure: 100, estimate: 1, lower: 0.9, upper: 1.1 }
];

describe("interpolateCurveSample", () => {
  it("returns the exact sample at a matching exposure", () => {
    expect(interpolateCurveSample(samples, 50)).toEqual({ exposure: 50, estimate: 0.5, lower: 0.4, upper: 0.6 });
  });

  it("linearly interpolates estimate/lower/upper between two samples", () => {
    const mid = interpolateCurveSample(samples, 25);
    expect(mid.estimate).toBeCloseTo(0.25);
    expect(mid.lower).toBeCloseTo(0.15);
    expect(mid.upper).toBeCloseTo(0.35);
  });

  it("clamps to the first sample below the domain's minimum exposure", () => {
    expect(interpolateCurveSample(samples, -10).estimate).toBe(0);
  });

  it("clamps to the last sample above the domain's maximum exposure", () => {
    expect(interpolateCurveSample(samples, 200).estimate).toBe(1);
  });

  it("returns all-NaN for an empty sample list", () => {
    const result = interpolateCurveSample([], 50);
    expect(result.exposure).toBe(50);
    expect(Number.isNaN(result.estimate)).toBe(true);
    expect(Number.isNaN(result.lower)).toBe(true);
    expect(Number.isNaN(result.upper)).toBe(true);
  });

  it("carries endpointId through from the interpolated segment", () => {
    const withEndpoint: CurveSample[] = [
      { exposure: 0, estimate: 0, lower: 0, upper: 0, endpointId: "icgi" },
      { exposure: 100, estimate: 1, lower: 1, upper: 1, endpointId: "icgi" }
    ];
    expect(interpolateCurveSample(withEndpoint, 50).endpointId).toBe("icgi");
  });
});
