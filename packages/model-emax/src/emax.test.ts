import { describe, expect, it } from "vitest";
import {
  EMAX_MIN_DISTINCT_POSITIVE_X,
  EMAX_MIN_N,
  describeEmaxFit,
  fitEmax,
  predictEmax,
  predictEmaxAt,
  tQuantile975
} from "./emax";

/** Deterministic pseudo-noise (no Math.random in tests). */
function noise(i: number): number {
  return Math.sin(i * 12.9898) * 0.05;
}

/** Log-spaced positive exposures plus a few placebo (x=0) rows. */
function exposureGrid(count: number, max: number): number[] {
  const doses = Array.from({ length: count }, (_, i) => Math.exp((Math.log(max) * (i + 1)) / count));
  return [0, 0, 0, 0, ...doses];
}

function relClose(actual: number, expected: number, tol = 2e-3): void {
  const denom = Math.abs(expected) < 1e-9 ? 1 : Math.abs(expected);
  expect(Math.abs(actual - expected) / denom).toBeLessThan(tol);
}

describe("fitEmax — exact recovery on noiseless data (no starting values)", () => {
  // The core correctness property, mirroring model-loess's polynomial-
  // exactness test: grid + golden-section refinement must find the TRUE
  // parameters exactly, with no initial guess supplied anywhere.

  it("recovers E0/Emax/EC50 with γ fixed at 1 (plain Emax)", () => {
    const xs = exposureGrid(20, 500);
    const E0 = 10;
    const Emax = 40;
    const EC50 = 50;
    const ys = xs.map((x) => E0 + (Emax * x) / (EC50 + x));
    const fit = fitEmax(xs, ys)!;
    expect(fit).not.toBeNull();
    expect(fit.estimateGamma).toBe(false);
    expect(fit.gamma).toBe(1);
    relClose(fit.e0, E0);
    relClose(fit.emax, Emax);
    relClose(fit.ec50, EC50);
    expect(fit.rss).toBeLessThan(1e-6);
  });

  it("recovers a sigmoid (γ=2) when estimateGamma is true", () => {
    const xs = exposureGrid(24, 300);
    const E0 = 5;
    const Emax = 60;
    const EC50 = 40;
    const gamma = 2;
    const ys = xs.map((x) => E0 + (Emax * x ** gamma) / (EC50 ** gamma + x ** gamma));
    const fit = fitEmax(xs, ys, { estimateGamma: true })!;
    expect(fit).not.toBeNull();
    relClose(fit.e0, E0);
    relClose(fit.emax, Emax);
    relClose(fit.ec50, EC50, 5e-3);
    relClose(fit.gamma, gamma, 5e-3);
  });

  it("without estimateGamma, a γ=2 curve is NOT force-fit to γ=1 with zero residual", () => {
    const xs = exposureGrid(24, 300);
    const ys = xs.map((x) => 5 + (60 * x ** 2) / (40 ** 2 + x ** 2));
    const fit = fitEmax(xs, ys)!;
    expect(fit.gamma).toBe(1);
    expect(fit.rss).toBeGreaterThan(1); // real lack-of-fit, not a fluke exact match
  });

  it("estimateE0=false fixes E0 at exactly 0 (no placebo/SoC anchor)", () => {
    const xs = exposureGrid(20, 500);
    const Emax = 30;
    const EC50 = 60;
    const ys = xs.map((x) => (Emax * x) / (EC50 + x));
    const fit = fitEmax(xs, ys, { estimateE0: false })!;
    expect(fit.e0).toBe(0);
    expect(fit.estimateE0).toBe(false);
    relClose(fit.emax, Emax);
    relClose(fit.ec50, EC50);
    expect(fit.paramOrder).toEqual(["emax", "ec50"]);
  });

  it("a negative Emax recovers an inhibitory curve (no separate flag needed)", () => {
    const xs = exposureGrid(20, 500);
    const E0 = 80;
    const Emax = -70;
    const EC50 = 50;
    const ys = xs.map((x) => E0 + (Emax * x) / (EC50 + x));
    const fit = fitEmax(xs, ys)!;
    expect(fit.emax).toBeLessThan(0);
    relClose(fit.e0, E0);
    relClose(fit.emax, Emax);
    relClose(fit.ec50, EC50);
  });

  it("is deterministic: identical input yields byte-identical output across calls", () => {
    const xs = exposureGrid(20, 500);
    const ys = xs.map((x) => 10 + (40 * x) / (50 + x) + noise(x));
    const a = fitEmax(xs, ys, { estimateGamma: true });
    const b = fitEmax(xs, ys, { estimateGamma: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("fitEmax — support guards (unified minimum-support rule)", () => {
  it("returns null below EMAX_MIN_N points", () => {
    const xs = [0, 10, 20, 30];
    expect(xs.length).toBeLessThan(EMAX_MIN_N);
    const ys = xs.map((x) => 10 + (40 * x) / (50 + x));
    expect(fitEmax(xs, ys)).toBeNull();
  });

  it("returns null with fewer than EMAX_MIN_DISTINCT_POSITIVE_X distinct positive exposures", () => {
    // 6 rows but only 2 distinct positive doses — EC50 is not identifiable.
    const xs = [0, 0, 50, 50, 50, 100];
    expect(new Set(xs.filter((x) => x > 0)).size).toBeLessThan(EMAX_MIN_DISTINCT_POSITIVE_X);
    const ys = xs.map((x) => 10 + (40 * x) / (50 + x));
    expect(fitEmax(xs, ys)).toBeNull();
  });

  it("returns null when all-placebo (no positive exposure at all)", () => {
    const xs = [0, 0, 0, 0, 0, 0];
    const ys = xs.map(() => 10);
    expect(fitEmax(xs, ys)).toBeNull();
  });
});

describe("predictEmax / predictEmaxAt — bands", () => {
  const xs = exposureGrid(30, 400);
  const ys = xs.map((x, i) => 10 + (40 * x) / (50 + x) + noise(i));
  const fit = fitEmax(xs, ys)!;

  it("estimates track the underlying curve; bands bracket the estimate and are finite", () => {
    const out = predictEmax(fit, [10, 50, 100, 300]);
    for (const p of out) {
      const truth = 10 + (40 * p.exposure) / (50 + p.exposure);
      expect(Math.abs(p.estimate - truth)).toBeLessThan(2);
      expect(p.lower).toBeLessThan(p.estimate);
      expect(p.upper).toBeGreaterThan(p.estimate);
      expect(Number.isFinite(p.lower)).toBe(true);
      expect(Number.isFinite(p.upper)).toBe(true);
    }
  });

  it("SE is well-defined (finite, non-negative) at an arbitrary exposure", () => {
    const { se } = predictEmaxAt(fit, 75);
    expect(Number.isFinite(se)).toBe(true);
    expect(se).toBeGreaterThanOrEqual(0);
  });
});

describe("tQuantile975", () => {
  it("matches known t quantiles", () => {
    expect(tQuantile975(10)).toBeCloseTo(2.228, 2);
    expect(tQuantile975(30)).toBeCloseTo(2.042, 2);
    expect(tQuantile975(1000)).toBeCloseTo(1.962, 2);
  });
});

describe("describeEmaxFit — universal equation/parameter display", () => {
  it("plain Emax (γ fixed, E0 estimated): equation and all three params with SE", () => {
    const xs = exposureGrid(20, 500);
    const ys = xs.map((x, i) => 10 + (40 * x) / (50 + x) + noise(i));
    const fit = fitEmax(xs, ys)!;
    const { equation, params } = describeEmaxFit(fit);
    expect(equation).toContain("E0");
    expect(equation).not.toContain("γ");
    expect(params.map((p) => p.label)).toEqual(["E0", "Emax", "EC50"]);
    for (const p of params) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(p.se).toBeGreaterThanOrEqual(0);
    }
  });

  it("γ estimated + E0 fixed off: equation and params reflect both toggles", () => {
    const xs = exposureGrid(24, 300);
    const ys = xs.map((x, i) => (60 * x ** 2) / (40 ** 2 + x ** 2) + noise(i));
    const fit = fitEmax(xs, ys, { estimateGamma: true, estimateE0: false })!;
    const { equation, params } = describeEmaxFit(fit);
    expect(equation).not.toContain("E0");
    expect(equation).toContain("γ");
    expect(params.map((p) => p.label)).toEqual(["Emax", "EC50", "γ"]);
  });
});
