import { describe, expect, it } from "vitest";
import { fitLinearModel } from "./ols";

describe("fitLinearModel", () => {
  it("recovers the exact intercept/slope for a noiseless linear relationship", () => {
    const exposures = [0, 10, 20, 30, 40];
    const responses = exposures.map((x) => 5 + 1 * x); // response = 5 + x
    const params = fitLinearModel(exposures, responses)!;

    expect(params).not.toBeNull();
    expect(params.intercept).toBeCloseTo(5, 10);
    expect(params.slope).toBeCloseTo(1, 10);
    expect(params.rSquared).toBeCloseTo(1, 10);
    expect(params.residualStandardError).toBeCloseTo(0, 10);
    expect(params.n).toBe(5);
    expect(params.degreesOfFreedom).toBe(3);
    expect(params.covariance).not.toBeNull();
    expect(params.covariance!.b00).toBeCloseTo(0, 8);
    expect(params.covariance!.b11).toBeCloseTo(0, 8);
  });

  it("recovers approximately correct coefficients with noise, by a known hand-computed example", () => {
    // y = 2 + 3x, classic textbook example (Sxx = 10, Sxy = 30 -> slope = 3)
    const exposures = [1, 2, 3, 4, 5];
    const responses = [5.1, 7.9, 11.2, 13.8, 17.0];
    const params = fitLinearModel(exposures, responses)!;

    expect(params.slope).toBeCloseTo(3, 0); // within 0.5 of 3
    expect(params.intercept).toBeCloseTo(2, 0);
    expect(params.rSquared).toBeGreaterThan(0.99);
  });

  it("returns null for fewer than 3 observations", () => {
    expect(fitLinearModel([1, 2], [1, 2])).toBeNull();
  });

  it("returns null for mismatched array lengths", () => {
    expect(fitLinearModel([1, 2, 3], [1, 2])).toBeNull();
  });

  it("returns null when exposure has zero variance (a vertical line)", () => {
    expect(fitLinearModel([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });
});
