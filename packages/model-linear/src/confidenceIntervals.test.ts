import { describe, expect, it } from "vitest";
import { fitLinearModel } from "./ols";
import { bootstrapLinearConfidenceIntervals, waldLinearConfidenceIntervals } from "./confidenceIntervals";

const exposures = [0, 10, 20, 30, 40];
const responses = exposures.map((x) => 5 + x); // noiseless: response = 5 + x

describe("waldLinearConfidenceIntervals", () => {
  it("gives a zero-width interval for a noiseless (zero residual variance) fit", () => {
    const params = fitLinearModel(exposures, responses)!;
    const intervals = waldLinearConfidenceIntervals(params, [0, 20, 40]);
    for (const interval of intervals) {
      expect(interval.lower).toBeCloseTo(interval.upper, 6);
      expect(interval.method).toBe("wald");
    }
    expect(intervals[1].lower).toBeCloseTo(25, 6); // fitted value at x=20 is 5+20=25
  });

  it("widens with a noisy fit and always contains the point estimate", () => {
    const noisy = [5.1, 7.9, 11.2, 13.8, 17.0];
    const x = [1, 2, 3, 4, 5];
    const params = fitLinearModel(x, noisy)!;
    const [interval] = waldLinearConfidenceIntervals(params, [3]);
    const estimate = params.intercept + params.slope * 3;
    expect(interval.lower).toBeLessThanOrEqual(estimate);
    expect(interval.upper).toBeGreaterThanOrEqual(estimate);
    expect(interval.lower).toBeLessThan(interval.upper);
  });
});

describe("bootstrapLinearConfidenceIntervals", () => {
  it("is exactly reproducible from the same seed", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [5.1, 7.9, 11.2, 13.8, 17.0, 18.5, 22.1, 24.9];
    const a = bootstrapLinearConfidenceIntervals(x, y, [4, 6], { seed: 42, resamples: 100 });
    const b = bootstrapLinearConfidenceIntervals(x, y, [4, 6], { seed: 42, resamples: 100 });
    expect(a).toEqual(b);
  });

  it("collapses to the point estimate for a noiseless relationship", () => {
    const intervals = bootstrapLinearConfidenceIntervals(exposures, responses, [20], { seed: 1, resamples: 50 });
    expect(intervals[0].lower).toBeCloseTo(25, 6);
    expect(intervals[0].upper).toBeCloseTo(25, 6);
    expect(intervals[0].method).toBe("bootstrap");
  });
});
