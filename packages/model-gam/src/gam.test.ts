import { describe, expect, it } from "vitest";
import {
  buildCrBasis,
  crBasisRow,
  describeGamFit,
  fitGam,
  predictGam,
  predictGamAt,
  GAM_MIN_DISTINCT_X,
  GAM_MIN_N
} from "./gam";
import { cholesky, choleskySolve, symmetricEigenvalues } from "./linalg";

/** Deterministic PRNG so every assertion here is reproducible (no seeded-random flakes). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function logistic(v: number): number {
  return 1 / (1 + Math.exp(-v));
}

/** Bernoulli draws from a known logit curve. */
function simulate(n: number, seed: number, logit: (x: number) => number, xMax = 100) {
  const rand = mulberry32(seed);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * xMax;
    xs.push(x);
    ys.push(rand() < logistic(logit(x)) ? 1 : 0);
  }
  return { xs, ys };
}

describe("cubic regression spline basis (exact algebraic properties)", () => {
  const knots = [0, 1, 2.5, 4, 7, 10];

  it("interpolates the knot values: the basis row at knot j is the unit vector e_j", () => {
    // This is the defining property of the knot-value parameterization — f(x_j)
    // = β_j by construction. Anything else means D, B, or F is wrong.
    const basis = buildCrBasis(knots)!;
    expect(basis).not.toBeNull();
    knots.forEach((kx, j) => {
      const row = crBasisRow(kx, knots, basis.fPlus);
      row.forEach((v, i) => {
        expect(v).toBeCloseTo(i === j ? 1 : 0, 12);
      });
    });
  });

  it("is continuous across the interval boundaries it joins", () => {
    const basis = buildCrBasis(knots)!;
    for (let j = 1; j < knots.length - 1; j++) {
      const left = crBasisRow(knots[j]! - 1e-7, knots, basis.fPlus);
      const right = crBasisRow(knots[j]! + 1e-7, knots, basis.fPlus);
      left.forEach((v, i) => expect(v).toBeCloseTo(right[i]!, 6));
    }
  });

  it("penalizes a straight line EXACTLY zero", () => {
    // ∫f''² must vanish for any linear f. With β_i = a + b·x_i this is the
    // single strongest check on S: it pins both the null space and the scale.
    const basis = buildCrBasis(knots)!;
    for (const [a, b] of [
      [0, 1],
      [3, -2],
      [-7, 0.25]
    ]) {
      const beta = knots.map((x) => a! + b! * x);
      let quad = 0;
      for (let i = 0; i < beta.length; i++) {
        for (let j = 0; j < beta.length; j++) quad += beta[i]! * basis.s[i]![j]! * beta[j]!;
      }
      expect(Math.abs(quad)).toBeLessThan(1e-9);
    }
  });

  it("penalizes a genuinely curved shape strictly positively", () => {
    const basis = buildCrBasis(knots)!;
    const beta = knots.map((x) => x * x);
    let quad = 0;
    for (let i = 0; i < beta.length; i++) {
      for (let j = 0; j < beta.length; j++) quad += beta[i]! * basis.s[i]![j]! * beta[j]!;
    }
    expect(quad).toBeGreaterThan(1);
  });

  it("produces a symmetric positive semi-definite penalty of rank k−2", () => {
    const basis = buildCrBasis(knots)!;
    const k = knots.length;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) expect(basis.s[i]![j]!).toBeCloseTo(basis.s[j]![i]!, 12);
    }
    const eig = symmetricEigenvalues(basis.s);
    const max = Math.max(...eig.map((v) => Math.abs(v)));
    for (const v of eig) expect(v).toBeGreaterThan(-max * 1e-9);
    // The null space is exactly {constant, linear} ⇒ rank k − 2.
    expect(eig.filter((v) => v > max * 1e-8).length).toBe(k - 2);
  });

  it("reproduces a known cubic exactly between its knots", () => {
    // A natural cubic spline interpolating f(x)=x³ on [0,10] is NOT x³ (the end
    // conditions differ), but the basis must still reproduce whatever curve its
    // own second derivatives describe. Check against a direct tridiagonal solve.
    const basis = buildCrBasis(knots)!;
    const beta = knots.map((x) => Math.sin(x / 3));
    const probe = 3.2;
    const row = crBasisRow(probe, knots, basis.fPlus);
    let viaBasis = 0;
    for (let i = 0; i < row.length; i++) viaBasis += row[i]! * beta[i]!;

    // Independent evaluation: γ = B⁻¹Dβ, then the textbook cubic formula.
    const gamma = basis.fPlus.map((r) => r.reduce((acc, v, i) => acc + v * beta[i]!, 0));
    let j = 0;
    while (j < knots.length - 2 && probe > knots[j + 1]!) j++;
    const h = knots[j + 1]! - knots[j]!;
    const a = (knots[j + 1]! - probe) / h;
    const b = (probe - knots[j]!) / h;
    const direct =
      a * beta[j]! +
      b * beta[j + 1]! +
      ((a * a * a - a) * h * h * gamma[j]!) / 6 +
      ((b * b * b - b) * h * h * gamma[j + 1]!) / 6;
    expect(viaBasis).toBeCloseTo(direct, 12);
  });

  it("extrapolates linearly outside the knot range", () => {
    const basis = buildCrBasis(knots)!;
    const beta = knots.map((x) => Math.sin(x / 3));
    const evalAt = (x: number) =>
      crBasisRow(x, knots, basis.fPlus).reduce((acc, v, i) => acc + v * beta[i]!, 0);
    // Three collinear points below the first knot.
    const a = evalAt(-6);
    const b = evalAt(-4);
    const c = evalAt(-2);
    expect(b - a).toBeCloseTo(c - b, 10);
    // And above the last.
    const d = evalAt(12);
    const e = evalAt(14);
    const f = evalAt(16);
    expect(e - d).toBeCloseTo(f - e, 10);
  });
});

describe("fitGam support guards (abstention, never fabrication)", () => {
  it("abstains below the minimum N", () => {
    const xs = [1, 2, 3, 4];
    const ys = [0, 0, 1, 1];
    expect(xs.length).toBeLessThan(GAM_MIN_N);
    expect(fitGam(xs, ys)).toBeNull();
  });

  it("abstains below the minimum number of distinct exposures", () => {
    const xs = [1, 1, 1, 2, 2, 2, 3, 3];
    const ys = [0, 0, 1, 0, 1, 1, 1, 1];
    expect(new Set(xs).size).toBeLessThan(GAM_MIN_DISTINCT_X);
    expect(fitGam(xs, ys)).toBeNull();
  });

  it("abstains on a constant response (complete separation has no smooth to estimate)", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(fitGam(xs, xs.map(() => 1))).toBeNull();
    expect(fitGam(xs, xs.map(() => 0))).toBeNull();
  });

  it("abstains on mismatched input lengths", () => {
    expect(fitGam([1, 2, 3, 4, 5, 6], [0, 1, 0])).toBeNull();
  });

  it("drops non-finite rows rather than propagating NaN into the fit", () => {
    const { xs, ys } = simulate(60, 11, (x) => -2 + 0.05 * x);
    const clean = fitGam(xs, ys);
    const dirty = fitGam([...xs, Number.NaN, 5], [...ys, 1, Number.NaN]);
    expect(clean).not.toBeNull();
    expect(dirty).not.toBeNull();
    expect(dirty!.n).toBe(clean!.n);
    expect(dirty!.deviance).toBeCloseTo(clean!.deviance, 10);
  });
});

describe("fitGam behaviour", () => {
  it("is deterministic — identical input gives bit-identical output", () => {
    const { xs, ys } = simulate(200, 42, (x) => -3 + 0.06 * x);
    const a = fitGam(xs, ys)!;
    const b = fitGam(xs, ys)!;
    expect(a.lambda).toBe(b.lambda);
    expect(a.deviance).toBe(b.deviance);
    expect(a.coefficients).toEqual(b.coefficients);
  });

  it("keeps the estimate AND the interval strictly inside (0, 1) everywhere", () => {
    // This is the whole reason the family exists: binary loess on this shape
    // produced point estimates above 1.0 and CI floors below 0.
    const { xs, ys } = simulate(120, 7, (x) => -4 + 0.09 * x);
    const fit = fitGam(xs, ys)!;
    const grid = Array.from({ length: 200 }, (_, i) => (i / 199) * 100);
    for (const p of predictGam(fit, grid)) {
      expect(p.lower).toBeGreaterThan(0);
      expect(p.upper).toBeLessThan(1);
      expect(p.estimate).toBeGreaterThan(0);
      expect(p.estimate).toBeLessThan(1);
      expect(p.lower).toBeLessThanOrEqual(p.estimate);
      expect(p.estimate).toBeLessThanOrEqual(p.upper);
    }
  });

  it("stays bounded even on the pathological all-events-at-the-top shape", () => {
    // Steep, nearly separated data — the configuration that made loess overshoot.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 80; i++) {
      const x = i;
      xs.push(x);
      ys.push(x > 55 ? 1 : 0);
    }
    const fit = fitGam(xs, ys);
    expect(fit).not.toBeNull();
    for (const p of predictGam(fit!, [-20, 0, 40, 55, 70, 79, 150])) {
      expect(p.lower).toBeGreaterThanOrEqual(0);
      expect(p.upper).toBeLessThanOrEqual(1);
      expect(Number.isFinite(p.estimate)).toBe(true);
    }
  });

  it("recovers a known monotone logit trend", () => {
    const truth = (x: number) => -4 + 0.08 * x;
    const { xs, ys } = simulate(400, 2024, truth);
    const fit = fitGam(xs, ys)!;
    for (const x of [10, 30, 50, 70, 90]) {
      // Generous tolerance: 400 Bernoulli draws carry real sampling noise. The
      // claim under test is "recovers the trend", not "matches to 3 decimals".
      expect(predictGamAt(fit, x).estimate).toBeCloseTo(logistic(truth(x)), 1);
    }
  });

  it("recovers a genuinely NON-monotone logit — the case a linear model cannot express", () => {
    // An inverted-U exposure–response (efficacy falling off at high exposure) is
    // precisely the scientific question this family was added to answer.
    const truth = (x: number) => -3 + 0.16 * x - 0.0016 * x * x;
    const { xs, ys } = simulate(600, 99, truth);
    const fit = fitGam(xs, ys)!;
    const mid = predictGamAt(fit, 50).estimate;
    expect(mid).toBeGreaterThan(predictGamAt(fit, 5).estimate);
    expect(mid).toBeGreaterThan(predictGamAt(fit, 95).estimate);
    // A curve, not a line.
    expect(fit.edfSmooth).toBeGreaterThan(1.2);
  });

  it("collapses to a straight logit line as λ → ∞ (the penalty null space is exactly linear)", () => {
    const { xs, ys } = simulate(300, 5, (x) => -2 + 0.04 * x);
    const fit = fitGam(xs, ys, { lambda: 1e12 })!;
    const probe = [0, 20, 40, 60, 80, 100];
    const etas = probe.map((x) => predictGamAt(fit, x).eta);
    // Equal x-spacing ⇒ equal η-spacing iff η is linear in x.
    const step = etas[1]! - etas[0]!;
    for (let i = 1; i < etas.length - 1; i++) {
      expect(etas[i + 1]! - etas[i]!).toBeCloseTo(step, 4);
    }
    expect(fit.edfSmooth).toBeLessThan(1.05);
  });

  it("gives smaller EDF for a larger λ (the penalty actually bites)", () => {
    const { xs, ys } = simulate(300, 17, (x) => -3 + 0.15 * x - 0.0015 * x * x);
    const loose = fitGam(xs, ys, { lambda: 1e-6 })!;
    const tight = fitGam(xs, ys, { lambda: 1e6 })!;
    expect(loose.edf).toBeGreaterThan(tight.edf);
    expect(loose.deviance).toBeLessThanOrEqual(tight.deviance + 1e-6);
  });

  it("reports EDF between 1 (a line) and k (an unpenalized spline)", () => {
    const { xs, ys } = simulate(300, 31, (x) => -3 + 0.12 * x - 0.001 * x * x);
    const fit = fitGam(xs, ys)!;
    expect(fit.edf).toBeGreaterThan(1.5);
    expect(fit.edf).toBeLessThanOrEqual(fit.k + 1e-6);
    expect(fit.edfSmooth).toBeCloseTo(fit.edf - 1, 12);
    expect(fit.converged).toBe(true);
  });

  it("shrinks k when there are fewer distinct exposures than requested knots", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    const doses = [0, 25, 50, 75, 100];
    for (let i = 0; i < 100; i++) {
      const x = doses[i % doses.length]!;
      xs.push(x);
      ys.push(i % 3 === 0 || x > 60 ? 1 : 0);
    }
    const fit = fitGam(xs, ys, { k: 10 })!;
    expect(fit.k).toBe(doses.length);
    expect(fit.knots).toEqual(doses);
  });
});

describe("boundary reporting (flag it, never pass it off as an ordinary estimate)", () => {
  it("flags the upper λ boundary when the data supports no curvature at all", () => {
    // Bernoulli noise alone will not force this — on 500 random draws from a
    // linear logit REML legitimately settles at an interior λ with edf ≈ 1.4,
    // and so does mgcv. Rounding an expected event count to an integer leaves
    // residual curvature too. So invert the construction: CHOOSE the event
    // counts, then place each exposure at the x its proportion implies. The
    // empirical logit is then exactly linear in x, to machine precision, and
    // the REML score is monotone in λ with no interior optimum to find.
    const xs: number[] = [];
    const ys: number[] = [];
    const m = 20;
    for (let events = 1; events < m; events++) {
      const p = events / m;
      const x = (Math.log(p / (1 - p)) + 2.5) / 0.05;
      for (let r = 0; r < m; r++) {
        xs.push(x);
        ys.push(r < events ? 1 : 0);
      }
    }
    const fit = fitGam(xs, ys)!;
    expect(fit.lambdaBoundary).toBe("upper");
    expect(fit.edfSmooth).toBeLessThan(1.1);

    const described = describeGamFit(fit);
    expect(described.warning).toContain("boundary");
    expect(described.warning).toContain("logistic regression");
  });

  it("leaves a noisy-but-linear cohort as a near-line without over-claiming curvature", () => {
    const { xs, ys } = simulate(500, 3, (x) => -2.5 + 0.05 * x);
    const fit = fitGam(xs, ys)!;
    // Real Bernoulli noise buys a little wiggle; the guarantee is that it stays
    // far below the k − 1 degrees an unpenalized spline would spend.
    expect(fit.edfSmooth).toBeLessThan(2);
    expect(fit.edfSmooth).toBeLessThan(fit.k - 1);
  });

  it("reports no boundary flag for an ordinary interior optimum", () => {
    const { xs, ys } = simulate(600, 77, (x) => -3 + 0.16 * x - 0.0016 * x * x);
    const fit = fitGam(xs, ys)!;
    expect(fit.lambdaBoundary).toBeNull();
    expect(describeGamFit(fit).warning).toBeUndefined();
  });

  it("honours an explicit λ without inventing a boundary flag", () => {
    const { xs, ys } = simulate(200, 8, (x) => -2 + 0.05 * x);
    const fit = fitGam(xs, ys, { lambda: 12.5 })!;
    expect(fit.lambda).toBeCloseTo(12.5, 6);
    expect(fit.lambdaBoundary).toBeNull();
  });
});

describe("describeGamFit", () => {
  it("states the equation and the reportable parameters", () => {
    const { xs, ys } = simulate(300, 55, (x) => -3 + 0.14 * x - 0.0013 * x * x);
    const fit = fitGam(xs, ys)!;
    const d = describeGamFit(fit);
    expect(d.equation).toContain("logit(p)");
    expect(d.equation).toContain(`k = ${fit.k}`);
    expect(d.params.map((p) => p.label)).toEqual(["edf (smooth)", "λ (smoothing)", "deviance"]);
    for (const p of d.params) expect(Number.isFinite(p.value)).toBe(true);
  });
});

describe("linalg", () => {
  it("solves a symmetric positive definite system", () => {
    const a = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2]
    ];
    const l = cholesky(a)!;
    const b = [1, 2, 3];
    const x = choleskySolve(l, b);
    for (let i = 0; i < 3; i++) {
      let acc = 0;
      for (let j = 0; j < 3; j++) acc += a[i]![j]! * x[j]!;
      expect(acc).toBeCloseTo(b[i]!, 10);
    }
  });

  it("rejects a non-positive-definite matrix instead of returning garbage", () => {
    expect(
      cholesky([
        [1, 2],
        [2, 1]
      ])
    ).toBeNull();
  });

  it("recovers known eigenvalues", () => {
    const eig = symmetricEigenvalues([
      [2, 0, 0],
      [0, 5, 0],
      [0, 0, -1]
    ]).sort((p, q) => p - q);
    expect(eig[0]!).toBeCloseTo(-1, 10);
    expect(eig[1]!).toBeCloseTo(2, 10);
    expect(eig[2]!).toBeCloseTo(5, 10);
  });
});
