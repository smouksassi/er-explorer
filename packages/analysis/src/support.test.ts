import { describe, expect, it } from "vitest";
import { summarizeDistribution } from "./legacyStatistics";
import { MIN_FIT_N, MIN_SUMMARY_N, supportTierFor } from "./support";

describe("unified minimum-support rule (I11)", () => {
  it("thresholds agree (one rule, not two)", () => {
    expect(MIN_FIT_N).toBe(MIN_SUMMARY_N);
  });

  it("tiers: full ≥ 5, minimal 2–4, single 1", () => {
    expect(supportTierFor(5)).toBe("full");
    expect(supportTierFor(120)).toBe("full");
    expect(supportTierFor(4)).toBe("minimal");
    expect(supportTierFor(2)).toBe("minimal");
    expect(supportTierFor(1)).toBe("single");
  });

  it("full summary keeps the five-number shape", () => {
    const s = summarizeDistribution([1, 2, 3, 4, 5, 6, 7, 8])!;
    expect(s.tier).toBe("full");
    expect(s.q1).toBeCloseTo(2.75, 10);
    expect(s.q3).toBeCloseTo(6.25, 10);
    expect(Number.isFinite(s.whiskerLow)).toBe(true);
    expect(Number.isFinite(s.whiskerHigh)).toBe(true);
  });

  it("minimal summary (N 2–4) abstains on quartiles/whiskers with NaN; min/median/max/mean stay honest", () => {
    const s = summarizeDistribution([10, 30, 20])!;
    expect(s.tier).toBe("minimal");
    expect(s.n).toBe(3);
    expect(s.min).toBe(10);
    expect(s.median).toBe(20);
    expect(s.max).toBe(30);
    expect(s.mean).toBe(20);
    expect(Number.isNaN(s.q1)).toBe(true);
    expect(Number.isNaN(s.q3)).toBe(true);
    expect(Number.isNaN(s.whiskerLow)).toBe(true);
    expect(Number.isNaN(s.whiskerHigh)).toBe(true);
    expect(s.outliers).toEqual([]);
  });

  it("single summary (N=1) collapses to the one value", () => {
    const s = summarizeDistribution([42])!;
    expect(s.tier).toBe("single");
    expect(s.min).toBe(42);
    expect(s.median).toBe(42);
    expect(s.max).toBe(42);
    expect(Number.isNaN(s.q1)).toBe(true);
  });

  it("empty input still returns null (no tier for n=0)", () => {
    expect(summarizeDistribution([])).toBeNull();
  });
});
