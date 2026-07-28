import { describe, expect, it } from "vitest";
import { meanConfidenceInterval, tQuantile, zForLevel } from "./statistics";

describe("zForLevel", () => {
  it("matches the well-known 1.96 for a 95% interval", () => {
    expect(zForLevel(0.95)).toBeCloseTo(1.96, 2);
  });
});

describe("tQuantile", () => {
  it("is wider than the normal quantile at small degrees of freedom", () => {
    const z = zForLevel(0.95);
    const t10 = tQuantile(10, 0.95);
    expect(t10).toBeGreaterThan(z);
    expect(t10).toBeCloseTo(2.228, 1); // textbook t(10, .975) ~= 2.228
  });

  it("converges to the normal quantile as degrees of freedom grows", () => {
    const z = zForLevel(0.95);
    const tLarge = tQuantile(10000, 0.95);
    expect(Math.abs(tLarge - z)).toBeLessThan(0.01);
  });

  it("falls back to the normal quantile for non-positive/non-finite degrees of freedom", () => {
    expect(tQuantile(0, 0.95)).toBeCloseTo(zForLevel(0.95), 10);
    expect(tQuantile(-1, 0.95)).toBeCloseTo(zForLevel(0.95), 10);
    expect(tQuantile(Infinity, 0.95)).toBeCloseTo(zForLevel(0.95), 10);
  });
});

describe("meanConfidenceInterval", () => {
  it("computes mean, n, and a CI that contains the mean", () => {
    const result = meanConfidenceInterval([10, 12, 11, 13, 9]);
    expect(result.mean).toBeCloseTo(11, 10);
    expect(result.n).toBe(5);
    expect(result.lower).toBeLessThan(result.mean);
    expect(result.upper).toBeGreaterThan(result.mean);
    expect(result.standardDeviation).toBeGreaterThan(0);
  });

  it("returns a degenerate (zero-width) interval for a single value", () => {
    const result = meanConfidenceInterval([42]);
    expect(result.mean).toBe(42);
    expect(result.lower).toBe(42);
    expect(result.upper).toBe(42);
    expect(result.standardDeviation).toBe(0);
  });

  it("returns NaNs for an empty sample rather than throwing", () => {
    const result = meanConfidenceInterval([]);
    expect(result.n).toBe(0);
    expect(Number.isNaN(result.mean)).toBe(true);
  });
});
