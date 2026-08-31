import { describe, expect, it } from "vitest";
import { LOESS_MIN_N, fitLoess, predictLoess, predictLoessAt, tQuantile975 } from "./loess";

/** Deterministic pseudo-noise (no Math.random in tests). */
function noise(i: number): number {
  return Math.sin(i * 12.9898) * 0.05;
}

describe("fitLoess — exact polynomial reproduction", () => {
  // A degree-d local regression reproduces data lying exactly on a degree-d
  // polynomial, for ANY span — the strongest correctness property short of an
  // external reference.
  const xs = Array.from({ length: 40 }, (_, i) => i / 2);

  it("degree 1 reproduces a line exactly", () => {
    const ys = xs.map((x) => 3 + 0.5 * x);
    const fit = fitLoess(xs, ys, { span: 0.4, degree: 1 })!;
    for (const x0 of [0, 3.7, 10, 19.5]) {
      expect(predictLoessAt(fit, x0).estimate).toBeCloseTo(3 + 0.5 * x0, 8);
    }
    expect(fit.sigma).toBeCloseTo(0, 6);
  });

  it("degree 2 reproduces a quadratic exactly (R default degree)", () => {
    const ys = xs.map((x) => 1 - 0.3 * x + 0.02 * x * x);
    const fit = fitLoess(xs, ys, { span: 0.75, degree: 2 })!;
    for (const x0 of [0.5, 7.25, 14, 19]) {
      expect(predictLoessAt(fit, x0).estimate).toBeCloseTo(1 - 0.3 * x0 + 0.02 * x0 * x0, 8);
    }
  });

  it("span > 1 still fits (R h-scaling rule)", () => {
    const ys = xs.map((x) => 2 + x);
    const fit = fitLoess(xs, ys, { span: 1.5, degree: 1 })!;
    expect(predictLoessAt(fit, 10).estimate).toBeCloseTo(12, 6);
  });
});

describe("fitLoess — support guards (unified minimum-support rule)", () => {
  it("returns null below LOESS_MIN_N points", () => {
    const xs = [1, 2, 3, 4];
    expect(xs.length).toBeLessThan(LOESS_MIN_N);
    expect(fitLoess(xs, [1, 2, 1, 2], { degree: 1 })).toBeNull();
  });

  it("returns null when distinct exposures cannot support the degree", () => {
    expect(fitLoess([1, 1, 1, 2, 2, 2], [0, 1, 0, 1, 0, 1], { degree: 2 })).toBeNull();
  });
});

describe("predictLoess — bands and smoother behavior", () => {
  const xs = Array.from({ length: 60 }, (_, i) => i / 3);
  const ys = xs.map((x, i) => Math.log1p(x) + noise(i));

  it("estimates track the underlying trend and bands bracket them", () => {
    const fit = fitLoess(xs, ys)!;
    const out = predictLoess(fit, [2, 8, 15]);
    for (const p of out) {
      // Wide-span loess carries smoothing bias where curvature is high (the
      // low end of a log curve) — assert tracking, not exactness.
      expect(Math.abs(p.estimate - Math.log1p(p.exposure))).toBeLessThan(0.15);
      expect(p.lower).toBeLessThan(p.estimate);
      expect(p.upper).toBeGreaterThan(p.estimate);
    }
  });

  it("binary responses are legal and NEVER clamped (round-2 §I.4)", () => {
    const bx = Array.from({ length: 50 }, (_, i) => i);
    const by = bx.map((x) => (x > 20 ? 1 : 0));
    const fit = fitLoess(bx, by)!;
    const p = predictLoess(fit, [0, 20, 25, 49]);
    expect(p.every((q) => Number.isFinite(q.estimate))).toBe(true);
    // The smoother may legitimately leave [0,1] near the step; assert we do
    // not clamp by checking values are not artificially pinned.
    const nearStep = predictLoessAt(fit, 21).estimate;
    expect(nearStep).toBeGreaterThan(0.3);
  });

  it("effective parameters grow as span shrinks", () => {
    const wide = fitLoess(xs, ys, { span: 0.9, degree: 2 })!;
    const tight = fitLoess(xs, ys, { span: 0.3, degree: 2 })!;
    expect(tight.enp).toBeGreaterThan(wide.enp);
  });
});

describe("tQuantile975", () => {
  it("matches known t quantiles", () => {
    expect(tQuantile975(10)).toBeCloseTo(2.228, 2);
    expect(tQuantile975(30)).toBeCloseTo(2.042, 2);
    expect(tQuantile975(1000)).toBeCloseTo(1.962, 2);
  });
});
