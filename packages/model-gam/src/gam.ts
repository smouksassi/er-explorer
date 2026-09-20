/**
 * Binomial GAM: logit(p) = β₀ + f(x), with f a PENALIZED CUBIC REGRESSION
 * SPLINE — the analog of `mgcv::gam(y ~ s(x, bs="cr"), family = binomial,
 * method = "REML")`.
 *
 * WHY this replaces loess on binary endpoints: an unconstrained local
 * regression fits the probability scale directly, so nothing stops it (or its
 * CI) leaving [0, 1] — on the bundled icgi/AUC data a realistic span=0.5
 * subgroup fit reaches an estimate of 1.07 and a CI of −0.11…1.89. Here the
 * smoothing happens on the LOGIT scale and comes back through the inverse
 * link, so estimate AND interval are inside (0, 1) BY CONSTRUCTION — not by
 * clamping (which would be a lie about the fit) and not by padding the axis
 * (which only hides it). It also answers the actual scientific question the
 * user posed: the effect of exposure need not be linear *inside* the logit.
 *
 * Basis choice: mgcv's default for `s()` is a thin-plate regression spline
 * (`bs="tp"`), which needs an eigen-truncation of a thin-plate penalty to
 * reproduce. `bs="cr"` is defined by a closed-form knot-value
 * parameterization (Wood, *Generalized Additive Models*, §5.3.1) that can be
 * reproduced EXACTLY, so it is the honest cross-check target — R side:
 * `s(x, bs="cr", k=…)`.
 *
 * Fitting is deterministic with no user-supplied starting values, matching
 * the `model-emax` precedent: penalized IRLS inner loop (started from the
 * standard binomial GLM initialization, not a guess), λ chosen by an
 * exhaustive log-spaced grid — which cannot miss the global basin — followed
 * by golden-section refinement, which needs only a bracket.
 */

import { cholesky, choleskyLogDet, choleskySolve, frobenius, symmetricEigenvalues } from "./linalg";

/** Minimum observations for any fit (mirrors the app's unified support rule). */
export const GAM_MIN_N = 5;
/** A cubic spline penalty needs at least this many distinct exposures to mean anything. */
export const GAM_MIN_DISTINCT_X = 4;
/** mgcv's default basis dimension for `s(x)`. */
export const GAM_DEFAULT_K = 10;

/** 97.5th percentile of the standard normal — the scale is KNOWN (φ=1) for a
 * binomial GAM, so the reference distribution is normal, not t. */
const Z_975 = 1.959963984540054;
/**
 * Bound on the linear predictor, and with it the floor on the IRLS weights
 * w = μ(1−μ).
 *
 * This is a CONDITIONING control, not cosmetic clamping. On a completely
 * separated cohort (every event above some exposure, none below) the MLE does
 * not exist and η runs away; the weights follow it down. At ±30 the floor is
 * ~1e-13, and against a λS block reaching ~1e9 that puts 22 orders of
 * magnitude inside one matrix — the Cholesky loses every significant digit
 * and fails outright, so a fit that should simply have been reported as
 * "separated" disappears instead. ±15 floors w near 3e-7 and keeps the
 * factorization well inside double precision.
 *
 * Nothing reportable is lost: η = 15 is p = 0.9999997. No exposure–response
 * dataset distinguishes that from 1 − 1e-13, and pretending otherwise would
 * be false precision about a fit that has no finite maximum anyway.
 */
const ETA_CLAMP = 15;
/** Matching floor on w, so a clamped η cannot produce a zero-weight row. */
const MIN_IRLS_WEIGHT = 1e-8;

export interface GamOptions {
  /** Basis dimension (number of knots). Default {@link GAM_DEFAULT_K}; auto-reduced
   * when there are fewer distinct exposures than knots. */
  k?: number;
  /** Fix the smoothing parameter instead of selecting it by REML. Mainly a
   * testing/override hook — leave unset for the normal automatic fit. */
  lambda?: number;
}

export interface GamFit {
  /** [intercept, ...constrained smooth coefficients]. */
  coefficients: number[];
  knots: number[];
  /** Basis dimension actually used (knot count), after any auto-reduction. */
  k: number;
  /** Smoothing parameter on the ORIGINAL penalty scale — comparable to mgcv's `fit$sp`. */
  lambda: number;
  /** Effective degrees of freedom of the whole model (intercept included) —
   * comparable to `sum(fit$edf)`. */
  edf: number;
  /** EDF of the smooth term alone (total − intercept) — comparable to the
   * `edf` column of `summary(fit)$s.table`. 1.0 means "a straight line on the
   * logit scale", i.e. ordinary logistic regression. */
  edfSmooth: number;
  deviance: number;
  n: number;
  /** REML score at the optimum, up to an additive constant (the ARGMIN, the
   * fitted values, λ and EDF are the quantities comparable to R — not this
   * raw number, whose constant conventions differ). */
  reml: number;
  converged: boolean;
  /** Non-null when the λ search pinned against the edge of its grid rather
   * than settling on an interior optimum — the same "flag it, never present
   * it as an ordinary estimate" rule the Emax family follows. "upper" means
   * the data supports no curvature at all (the smooth collapsed to a straight
   * logit line); "lower" means it wanted more wiggle than the basis allows. */
  lambdaBoundary: "lower" | "upper" | null;
  /** Internals needed for prediction — not part of the reporting surface. */
  z: number[][];
  fPlus: number[][];
  cholA: number[][];
}

export interface GamPrediction {
  exposure: number;
  estimate: number;
  lower: number;
  upper: number;
}

function logistic(eta: number): number {
  if (eta >= 0) {
    const e = Math.exp(-eta);
    return 1 / (1 + e);
  }
  const e = Math.exp(eta);
  return e / (1 + e);
}

/* ------------------------------------------------------------------ *
 * Cubic regression spline basis (Wood §5.3.1)
 *
 * The spline is parameterized by its VALUES at the knots, β_i = f(x_i). Its
 * second derivatives at the knots follow from β by γ = B⁻¹Dβ (natural end
 * conditions: γ is zero at the first and last knot), and the wiggliness
 * penalty ∫f''(x)²dx is exactly βᵀDᵀB⁻¹Dβ.
 * ------------------------------------------------------------------ */

export interface CrBasis {
  /** k×k: row j maps β to the second derivative at knot j (rows 0 and k−1 are zero). */
  fPlus: number[][];
  /** k×k penalty S = DᵀB⁻¹D. */
  s: number[][];
}

/** Exported for the exact algebraic tests only — not part of the package surface
 * (`index.ts` does not re-export it). */
export function buildCrBasis(knots: number[]): CrBasis | null {
  const k = knots.length;
  const m = k - 2;
  if (m < 1) return null;

  const h: number[] = [];
  for (let i = 0; i < k - 1; i++) {
    const gap = knots[i + 1]! - knots[i]!;
    if (!(gap > 0)) return null;
    h.push(gap);
  }

  const d: number[][] = Array.from({ length: m }, () => new Array<number>(k).fill(0));
  const b: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let r = 0; r < m; r++) {
    const hr = h[r]!;
    const hr1 = h[r + 1]!;
    d[r]![r] = 1 / hr;
    d[r]![r + 1] = -1 / hr - 1 / hr1;
    d[r]![r + 2] = 1 / hr1;
    b[r]![r] = (hr + hr1) / 3;
    if (r + 1 < m) b[r]![r + 1] = hr1 / 6;
    if (r - 1 >= 0) b[r]![r - 1] = hr / 6;
  }

  // B is symmetric and strictly diagonally dominant, hence positive definite.
  const lb = cholesky(b);
  if (!lb) return null;

  // F = B⁻¹D, solved one column of D at a time (m×k).
  const f: number[][] = Array.from({ length: m }, () => new Array<number>(k).fill(0));
  for (let col = 0; col < k; col++) {
    const rhs = Array.from({ length: m }, (_, r) => d[r]![col]!);
    const sol = choleskySolve(lb, rhs);
    for (let r = 0; r < m; r++) f[r]![col] = sol[r]!;
  }

  const fPlus: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let r = 0; r < m; r++) fPlus[r + 1] = [...f[r]!];

  // S = DᵀF, symmetrized against round-off.
  const s: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (let r = 0; r < m; r++) sum += d[r]![i]! * f[r]![j]!;
      s[i]![j] = sum;
    }
  }
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const v = (s[i]![j]! + s[j]![i]!) / 2;
      s[i]![j] = v;
      s[j]![i] = v;
    }
  }

  return { fPlus, s };
}

/** One row of the unconstrained basis: f(x) as a linear combination of the knot
 * values β. Exported for the exact algebraic tests only (see {@link buildCrBasis}). */
export function crBasisRow(x: number, knots: number[], fPlus: number[][]): number[] {
  const k = knots.length;
  const row = new Array<number>(k).fill(0);

  // Below the first knot / above the last: extend LINEARLY, which is what the
  // natural end conditions (zero second derivative at the boundary knots)
  // imply. In this app curves are clipped to their cohort's exposure support
  // anyway, so this is defensive rather than routine.
  if (x <= knots[0]!) {
    const h = knots[1]! - knots[0]!;
    row[0] = 1;
    const slope = new Array<number>(k).fill(0);
    slope[0] = -1 / h;
    slope[1] = 1 / h;
    // f'(x₀) = (β₁−β₀)/h − (h/6)γ₁, using the natural end condition γ₀ = 0.
    for (let i = 0; i < k; i++) slope[i] = slope[i]! - (h / 6) * fPlus[1]![i]!;
    const dx = x - knots[0]!;
    for (let i = 0; i < k; i++) row[i] = row[i]! + dx * slope[i]!;
    return row;
  }
  if (x >= knots[k - 1]!) {
    const h = knots[k - 1]! - knots[k - 2]!;
    row[k - 1] = 1;
    const slope = new Array<number>(k).fill(0);
    slope[k - 2] = -1 / h;
    slope[k - 1] = 1 / h;
    // f'(x_{k−1}) = (β_{k−1}−β_{k−2})/h + (h/6)γ_{k−2}, using γ_{k−1} = 0.
    for (let i = 0; i < k; i++) slope[i] = slope[i]! + (h / 6) * fPlus[k - 2]![i]!;
    const dx = x - knots[k - 1]!;
    for (let i = 0; i < k; i++) row[i] = row[i]! + dx * slope[i]!;
    return row;
  }

  let j = 0;
  while (j < k - 2 && x > knots[j + 1]!) j++;
  const h = knots[j + 1]! - knots[j]!;
  const a = (knots[j + 1]! - x) / h;
  const bb = (x - knots[j]!) / h;
  const cm = ((a * a * a - a) * h * h) / 6;
  const cp = ((bb * bb * bb - bb) * h * h) / 6;
  row[j] = row[j]! + a;
  row[j + 1] = row[j + 1]! + bb;
  for (let i = 0; i < k; i++) {
    row[i] = row[i]! + cm * fPlus[j]![i]! + cp * fPlus[j + 1]![i]!;
  }
  return row;
}

/**
 * Sum-to-zero identifiability constraint, absorbed by reparameterization —
 * mgcv's default for `s()`. With c = column sums of the basis over the data,
 * a Householder reflector H maps c onto ±‖c‖e₁, so every column of H except
 * the first is orthogonal to c: Z = H[:, 1:] satisfies cᵀZ = 0 and β = Zβ̃
 * automatically respects the constraint.
 */
function constraintNullSpace(colSums: number[]): number[][] {
  const k = colSums.length;
  let norm = 0;
  for (const v of colSums) norm += v * v;
  norm = Math.sqrt(norm);
  const sign = colSums[0]! >= 0 ? 1 : -1;
  const v = [...colSums];
  v[0] = v[0]! + sign * norm;
  let vtv = 0;
  for (const value of v) vtv += value * value;

  const z: number[][] = Array.from({ length: k }, () => new Array<number>(k - 1).fill(0));
  for (let i = 0; i < k; i++) {
    for (let jj = 1; jj < k; jj++) {
      const h = (i === jj ? 1 : 0) - (2 * v[i]! * v[jj]!) / vtv;
      z[i]![jj - 1] = h;
    }
  }
  return z;
}

interface PirlsResult {
  beta: number[];
  eta: number[];
  deviance: number;
  cholA: number[][];
  logDetA: number;
  /** XᵀWX at convergence, for the EDF trace. */
  xtwx: number[][];
  converged: boolean;
}

/** Penalized IRLS at a FIXED λ (the inner loop of the outer REML iteration). */
function pirls(x: number[][], y: number[], sPen: number[][], lambda: number): PirlsResult | null {
  const n = x.length;
  const p = x[0]!.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);

  // Standard binomial GLM start: μ = (y + 0.5)/2. Deterministic, not a guess.
  for (let i = 0; i < n; i++) {
    mu[i] = (y[i]! + 0.5) / 2;
    eta[i] = Math.log(mu[i]! / (1 - mu[i]!));
  }

  let beta = new Array<number>(p).fill(0);
  let deviance = Number.POSITIVE_INFINITY;
  let cholA: number[][] | null = null;
  let xtwx: number[][] = [];
  let converged = false;

  for (let iter = 0; iter < 100; iter++) {
    const w = new Array<number>(n).fill(0);
    const z = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const m = mu[i]!;
      const wi = Math.max(m * (1 - m), MIN_IRLS_WEIGHT);
      w[i] = wi;
      z[i] = eta[i]! + (y[i]! - m) / wi;
    }

    const a: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const rhs = new Array<number>(p).fill(0);
    const cross: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < n; i++) {
      const row = x[i]!;
      const wi = w[i]!;
      const zi = z[i]!;
      for (let r = 0; r < p; r++) {
        const wr = wi * row[r]!;
        rhs[r] = rhs[r]! + wr * zi;
        for (let c = r; c < p; c++) cross[r]![c] = cross[r]![c]! + wr * row[c]!;
      }
    }
    for (let r = 0; r < p; r++) {
      for (let c = r; c < p; c++) {
        cross[c]![r] = cross[r]![c]!;
      }
    }
    // Tiny ridge on the diagonal: guards the Cholesky when a basis column is
    // effectively unused by the current weights. Small enough not to move the fit.
    let trace = 0;
    for (let r = 0; r < p; r++) trace += cross[r]![r]!;
    const ridge = Math.max(trace, 1) * 1e-12;
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) a[r]![c] = cross[r]![c]! + lambda * sPen[r]![c]!;
      a[r]![r] = a[r]![r]! + ridge;
    }

    const l = cholesky(a);
    if (!l) return null;
    beta = choleskySolve(l, rhs);

    let dev = 0;
    for (let i = 0; i < n; i++) {
      let e = 0;
      const row = x[i]!;
      for (let r = 0; r < p; r++) e += row[r]! * beta[r]!;
      e = Math.max(-ETA_CLAMP, Math.min(ETA_CLAMP, e));
      eta[i] = e;
      const m = logistic(e);
      mu[i] = m;
      dev += y[i]! === 1 ? -2 * Math.log(m) : -2 * Math.log(1 - m);
    }

    cholA = l;
    xtwx = cross;
    const rel = Math.abs(dev - deviance) / (Math.abs(dev) + 0.1);
    deviance = dev;
    if (rel < 1e-10) {
      converged = true;
      break;
    }
  }

  if (!cholA) return null;
  return { beta, eta, deviance, cholA, logDetA: choleskyLogDet(cholA), xtwx, converged };
}

/** Laplace-approximate REML score (φ = 1 for binomial), up to an additive constant. */
function remlScore(
  fit: PirlsResult,
  sPen: number[][],
  lambda: number,
  penaltyRank: number,
  logDetSPositive: number
): number {
  const p = fit.beta.length;
  let bsb = 0;
  for (let r = 0; r < p; r++) {
    let acc = 0;
    for (let c = 0; c < p; c++) acc += sPen[r]![c]! * fit.beta[c]!;
    bsb += fit.beta[r]! * acc;
  }
  const penalized = fit.deviance / 2 + (lambda * bsb) / 2;
  const logDetLambdaS = penaltyRank * Math.log(lambda) + logDetSPositive;
  return penalized - logDetLambdaS / 2 + fit.logDetA / 2;
}

function logspace(lo: number, hi: number, count: number): number[] {
  const a = Math.log(lo);
  const b = Math.log(hi);
  const step = (b - a) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.exp(a + i * step));
}

/** Golden-section minimization over a bracket — no starting value, only bounds. */
function goldenSectionMin(lo: number, hi: number, f: (v: number) => number, iterations = 25): number {
  // 25 iterations shrink the bracket by 0.618²⁵ ≈ 5e-6; the bracket here is
  // one grid step of log λ (~1.15), so the residual uncertainty in log λ is
  // ~1e-5 — far below anything that moves a fitted curve. Each iteration is a
  // full PIRLS fit, so extra iterations are not free.
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < iterations; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * Fit logit(p) = β₀ + f(x). Returns null — an abstention, never a fabricated
 * curve — below {@link GAM_MIN_N} points, below {@link GAM_MIN_DISTINCT_X}
 * distinct exposures, when the response is all-0 or all-1 (a smoother of a
 * constant response is meaningless and the IRLS weights collapse), or when
 * the linear algebra cannot be completed.
 */
export function fitGam(xs: number[], ys: number[], options?: GamOptions): GamFit | null {
  const n = xs.length;
  if (n !== ys.length || n < GAM_MIN_N) return null;

  const finite: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) finite.push({ x, y });
  }
  if (finite.length < GAM_MIN_N) return null;

  const responses = finite.map((r) => (r.y > 0.5 ? 1 : 0));
  const anyOne = responses.some((v) => v === 1);
  const anyZero = responses.some((v) => v === 0);
  if (!anyOne || !anyZero) return null;

  const uniqueX = [...new Set(finite.map((r) => r.x))].sort((a, b) => a - b);
  if (uniqueX.length < GAM_MIN_DISTINCT_X) return null;

  const requestedK = options?.k ?? GAM_DEFAULT_K;
  const k = Math.max(GAM_MIN_DISTINCT_X, Math.min(requestedK, uniqueX.length));

  // Knot placement reproduces mgcv's `place.knots` EXACTLY: the interior knots
  // sit at evenly spaced FRACTIONAL indices into the sorted distinct exposures,
  // linearly interpolated — not rounded to the nearest order statistic. Rounding
  // would be defensible on its own terms but would quietly desynchronize every
  // R cross-check, which is the point of choosing `bs="cr"` in the first place.
  const nu = uniqueX.length;
  const delta = (nu - 1) / (k - 1);
  const knots: number[] = [uniqueX[0]!];
  for (let i = 1; i <= k - 2; i++) {
    const pos = delta * i;
    const lb = Math.floor(pos);
    const frac = pos - lb;
    knots.push(uniqueX[lb]! * (1 - frac) + uniqueX[Math.min(lb + 1, nu - 1)]! * frac);
  }
  knots.push(uniqueX[nu - 1]!);
  for (let i = 1; i < k; i++) {
    if (!(knots[i]! > knots[i - 1]!)) return null;
  }

  const basis = buildCrBasis(knots);
  if (!basis) return null;

  const rows = finite.map((r) => crBasisRow(r.x, knots, basis.fPlus));

  const colSums = new Array<number>(k).fill(0);
  for (const row of rows) for (let i = 0; i < k; i++) colSums[i] = colSums[i]! + row[i]!;
  const z = constraintNullSpace(colSums);

  // Constrained design [1 | XZ] and the matching penalty (intercept unpenalized).
  const p = k; // 1 intercept + (k − 1) constrained smooth columns
  const design: number[][] = rows.map((row) => {
    const out = new Array<number>(p).fill(0);
    out[0] = 1;
    for (let c = 0; c < k - 1; c++) {
      let acc = 0;
      for (let i = 0; i < k; i++) acc += row[i]! * z[i]![c]!;
      out[c + 1] = acc;
    }
    return out;
  });

  const sTilde: number[][] = Array.from({ length: k - 1 }, () => new Array<number>(k - 1).fill(0));
  for (let r = 0; r < k - 1; r++) {
    for (let c = 0; c < k - 1; c++) {
      let acc = 0;
      for (let i = 0; i < k; i++) {
        let inner = 0;
        for (let j = 0; j < k; j++) inner += basis.s[i]![j]! * z[j]![c]!;
        acc += z[i]![r]! * inner;
      }
      sTilde[r]![c] = acc;
    }
  }

  // Put the penalty on the same scale as XᵀX so one fixed λ grid works for
  // any exposure units (mgcv rescales for the same reason).
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const row of design) {
    for (let r = 0; r < p; r++) for (let c = 0; c < p; c++) xtx[r]![c] = xtx[r]![c]! + row[r]! * row[c]!;
  }
  const sNorm = frobenius(sTilde);
  if (!(sNorm > 0)) return null;
  const sScale = frobenius(xtx) / sNorm;

  const sPen: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let r = 0; r < k - 1; r++) {
    for (let c = 0; c < k - 1; c++) sPen[r + 1]![c + 1] = sTilde[r]![c]! * sScale;
  }

  const eigen = symmetricEigenvalues(sTilde.map((row) => row.map((v) => v * sScale)));
  const maxEig = Math.max(...eigen.map(Math.abs));
  const positive = eigen.filter((v) => v > maxEig * 1e-9);
  const penaltyRank = positive.length;
  if (penaltyRank < 1) return null;
  const logDetSPositive = positive.reduce((acc, v) => acc + Math.log(v), 0);

  const scoreAt = (lambda: number): { score: number; fit: PirlsResult } | null => {
    const fit = pirls(design, responses, sPen, lambda);
    if (!fit) return null;
    return { score: remlScore(fit, sPen, lambda, penaltyRank, logDetSPositive), fit };
  };

  let lambdaScaled: number;
  let lambdaBoundary: "lower" | "upper" | null = null;

  if (options?.lambda !== undefined && Number.isFinite(options.lambda) && options.lambda > 0) {
    lambdaScaled = options.lambda / sScale;
  } else {
    const grid = logspace(1e-8, 1e8, 33);
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < grid.length; i++) {
      const r = scoreAt(grid[i]!);
      if (r && r.score < bestScore) {
        bestScore = r.score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    const gridBest = grid[bestIdx]!;

    // The refine never escapes the coarse grid's outer bounds, so a best index
    // sitting AT an edge means the optimum wants to go further — report it
    // rather than present an edge value as an ordinary estimate.
    lambdaBoundary = bestIdx === 0 ? "lower" : bestIdx === grid.length - 1 ? "upper" : null;

    const lo = Math.log(grid[Math.max(bestIdx - 1, 0)]!);
    const hi = Math.log(grid[Math.min(bestIdx + 1, grid.length - 1)]!);
    const refined = Math.exp(
      goldenSectionMin(lo, hi, (v) => scoreAt(Math.exp(v))?.score ?? Number.POSITIVE_INFINITY)
    );

    // Refinement must never be able to LOSE a fit we already hold. The bracket
    // spans a whole grid step, so on an ill-conditioned cohort it can land on a
    // λ where PIRLS fails — or, since golden-section assumes a unimodal score,
    // on one that simply scores worse than the grid point it started from.
    // Either way, keep the grid optimum: it is a real, already-evaluated fit.
    const refinedScore = scoreAt(refined)?.score;
    lambdaScaled = refinedScore !== undefined && refinedScore <= bestScore ? refined : gridBest;
  }

  const final = scoreAt(lambdaScaled);
  if (!final) return null;

  // EDF = tr((XᵀWX + λS)⁻¹ XᵀWX).
  let edf = 0;
  for (let j = 0; j < p; j++) {
    const col = Array.from({ length: p }, (_, r) => final.fit.xtwx[r]![j]!);
    const sol = choleskySolve(final.fit.cholA, col);
    edf += sol[j]!;
  }

  return {
    coefficients: final.fit.beta,
    knots,
    k,
    lambda: lambdaScaled * sScale,
    edf,
    edfSmooth: edf - 1,
    deviance: final.fit.deviance,
    n: finite.length,
    reml: final.score,
    converged: final.fit.converged,
    lambdaBoundary,
    z,
    fPlus: basis.fPlus,
    cholA: final.fit.cholA
  };
}

/** Design row (constrained, intercept included) at one exposure. */
function designRow(fit: GamFit, x0: number): number[] {
  const raw = crBasisRow(x0, fit.knots, fit.fPlus);
  const out = new Array<number>(fit.k).fill(0);
  out[0] = 1;
  for (let c = 0; c < fit.k - 1; c++) {
    let acc = 0;
    for (let i = 0; i < fit.k; i++) acc += raw[i]! * fit.z[i]![c]!;
    out[c + 1] = acc;
  }
  return out;
}

/**
 * Fitted probability and the standard error of the LINEAR PREDICTOR at x₀.
 * The SE is deliberately reported on the link scale: that is the quantity
 * whose interval transforms to a bounded probability interval, and it is
 * directly comparable to R's `predict(fit, type = "link", se.fit = TRUE)`.
 */
export function predictGamAt(fit: GamFit, x0: number): { estimate: number; se: number; eta: number } {
  const row = designRow(fit, x0);
  let eta = 0;
  for (let i = 0; i < row.length; i++) eta += row[i]! * fit.coefficients[i]!;
  const sol = choleskySolve(fit.cholA, row);
  let variance = 0;
  for (let i = 0; i < row.length; i++) variance += row[i]! * sol[i]!;
  const se = variance > 0 ? Math.sqrt(variance) : 0;
  return { estimate: logistic(eta), se, eta };
}

/**
 * Batch predictions with a 95% interval. The interval is formed on the LOGIT
 * scale and transformed back, so lower ≤ estimate ≤ upper and all three are
 * strictly inside (0, 1) — the structural property that motivated replacing
 * loess here.
 */
export function predictGam(fit: GamFit, exposures: number[]): GamPrediction[] {
  return exposures.map((exposure) => {
    const { eta, se } = predictGamAt(fit, exposure);
    return {
      exposure,
      estimate: logistic(eta),
      lower: logistic(eta - Z_975 * se),
      upper: logistic(eta + Z_975 * se)
    };
  });
}

/** Equation + parameter summary for the app's universal fit-description display. */
export function describeGamFit(fit: GamFit): {
  equation: string;
  params: Array<{ label: string; value: number; se?: number }>;
  warning?: string;
} {
  const equation = `logit(p) = β₀ + f(x), f = penalized cubic regression spline (k = ${fit.k})`;
  const params = [
    { label: "edf (smooth)", value: fit.edfSmooth },
    { label: "λ (smoothing)", value: fit.lambda },
    { label: "deviance", value: fit.deviance }
  ];
  let warning: string | undefined;
  if (fit.lambdaBoundary === "upper") {
    warning =
      "⚠ smoothing pinned to the search boundary — this cohort supports no curvature beyond a straight line on the logit scale (equivalent to ordinary logistic regression).";
  } else if (fit.lambdaBoundary === "lower") {
    warning =
      "⚠ smoothing pinned to the search boundary — the fit wants more flexibility than the basis allows; treat the wiggles with caution.";
  } else if (!fit.converged) {
    warning = "⚠ the penalized IRLS loop hit its iteration cap without converging — treat this fit with caution.";
  }
  return { equation, params, warning };
}
