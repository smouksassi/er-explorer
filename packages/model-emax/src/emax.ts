/**
 * Emax/Hill model: E(x) = E0 + Emax · x^γ / (EC50^γ + x^γ).
 *
 * Continuous endpoints only (binary Emax was considered and parked — a
 * nonlinear Emax nested inside a nonlinear logit link needs more data than
 * is typically available; see project memory). Fitting is DETERMINISTIC and
 * requires NO starting values: for any fixed (EC50, γ) the model is exactly
 * linear in (E0, Emax) via the substitution u(x) = x^γ/(EC50^γ+x^γ), so the
 * only genuinely nonlinear search is over (EC50, γ) — done by an exhaustive
 * log-spaced grid (never missing a far-off optimum) followed by golden-section
 * refinement (never needing an initial guess to converge from). This directly
 * answers the failure mode of naive Emax fitting (local-optimizer
 * initial-value sensitivity, e.g. ggquickeda's implementation): there is no
 * initial value to be sensitive to.
 */

export const EMAX_MIN_N = 5;
/** Need ≥3 distinct positive exposure levels to identify EC50 at all. */
export const EMAX_MIN_DISTINCT_POSITIVE_X = 3;

export interface EmaxOptions {
  /** Estimate the Hill exponent γ. Default false (γ fixed at 1 — plain Emax). */
  estimateGamma?: boolean;
  /** Estimate the baseline E0. Default true. Set false when there is no
   * placebo/standard-of-care anchor — E0 is fixed at 0 and the curve is
   * forced through the origin; the sign of Emax alone then decides
   * stimulatory vs. inhibitory. */
  estimateE0?: boolean;
}

type ParamKey = "e0" | "emax" | "ec50" | "gamma";

export interface EmaxFit {
  e0: number;
  emax: number;
  ec50: number;
  gamma: number;
  estimateE0: boolean;
  estimateGamma: boolean;
  n: number;
  /** Residual degrees of freedom: n − (active parameter count). */
  df: number;
  rss: number;
  sigma: number;
  /** Covariance matrix over the ACTIVE parameters only, ordered as {@link paramOrder}. */
  cov: number[][];
  paramOrder: ParamKey[];
  /** Non-null when the search pinned EC50 (or γ) against the edge of its grid
   * rather than settling on an interior value — the honest signature of a
   * poorly-identified parameter (a flat or edge-monotone RSS surface), not a
   * numerical accident. `null` = the fit found a genuine interior optimum. */
  ec50Boundary: "lower" | "upper" | null;
  gammaBoundary: "lower" | "upper" | null;
}

export interface EmaxPrediction {
  exposure: number;
  estimate: number;
  lower: number;
  upper: number;
}

/** Saturation fraction u(x) = x^γ/(EC50^γ+x^γ), computed via the ratio form
 * (EC50/x)^γ so it stays numerically bounded when x is far from EC50 in
 * either direction (no huge x^γ powers). u(0) = 0 for any EC50 > 0, γ > 0. */
function saturation(x: number, ec50: number, gamma: number): number {
  if (x <= 0) return 0;
  const ratio = ec50 / x;
  const ratioG = Math.pow(ratio, gamma);
  if (!Number.isFinite(ratioG)) return 0;
  return 1 / (1 + ratioG);
}

function meanAt(x: number, p: { e0: number; emax: number; ec50: number; gamma: number }): number {
  return p.e0 + p.emax * saturation(x, p.ec50, p.gamma);
}

/** OLS of y on u; `withIntercept=false` fixes e0 at 0 (regression through the origin). */
function olsFit(u: number[], y: number[], withIntercept: boolean): { e0: number; emax: number; rss: number } | null {
  const n = u.length;
  let e0: number;
  let emax: number;
  if (withIntercept) {
    let sumU = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumU += u[i]!;
      sumY += y[i]!;
    }
    const meanU = sumU / n;
    const meanY = sumY / n;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const du = u[i]! - meanU;
      sxx += du * du;
      sxy += du * (y[i]! - meanY);
    }
    if (sxx < 1e-12) return null;
    emax = sxy / sxx;
    e0 = meanY - emax * meanU;
  } else {
    let suu = 0;
    let suy = 0;
    for (let i = 0; i < n; i++) {
      suu += u[i]! * u[i]!;
      suy += u[i]! * y[i]!;
    }
    if (suu < 1e-12) return null;
    emax = suy / suu;
    e0 = 0;
  }
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const resid = y[i]! - (e0 + emax * u[i]!);
    rss += resid * resid;
  }
  return { e0, emax, rss };
}

function rssAt(
  xs: number[],
  ys: number[],
  ec50: number,
  gamma: number,
  withIntercept: boolean
): { e0: number; emax: number; rss: number } | null {
  const u = xs.map((x) => saturation(x, ec50, gamma));
  return olsFit(u, ys, withIntercept);
}

function logspace(lo: number, hi: number, count: number): number[] {
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const step = (logHi - logLo) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.exp(logLo + i * step));
}

/** Golden-section minimization of `f` over `[lo, hi]` (both already log-scale
 * inputs to `f` if the caller wants a log-scale search) — no starting value,
 * only a bracket; converges to the bracket's global minimum under unimodality,
 * and the caller re-brackets around the grid's best point so a non-unimodal
 * RSS surface still can't hide a far-off optimum from the search. */
function goldenSectionMin(lo: number, hi: number, f: (v: number) => number, iterations = 60): number {
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
 * Fit E(x) = E0 + Emax·x^γ/(EC50^γ+x^γ) with NO starting values: an
 * exhaustive log-spaced grid over (EC50, γ) — γ fixed at 1 unless
 * `estimateGamma` — picks the global neighborhood, then golden-section
 * refinement polishes each parameter (alternating with γ when both are
 * searched). Returns null below {@link EMAX_MIN_N} or with fewer than
 * {@link EMAX_MIN_DISTINCT_POSITIVE_X} distinct positive exposure levels
 * (EC50 is not identifiable otherwise), or when the OLS step is singular at
 * every grid point (u constant — should not happen once the distinct-level
 * guard passes, but guarded defensively rather than assumed).
 */
export function fitEmax(xs: number[], ys: number[], options?: EmaxOptions): EmaxFit | null {
  const n = xs.length;
  if (n !== ys.length || n < EMAX_MIN_N) return null;
  const estimateE0 = options?.estimateE0 ?? true;
  const estimateGamma = options?.estimateGamma ?? false;

  const positiveX = xs.filter((x) => x > 0);
  const distinctPositive = new Set(positiveX).size;
  if (distinctPositive < EMAX_MIN_DISTINCT_POSITIVE_X) return null;

  const xMinPos = Math.min(...positiveX);
  const xMaxPos = Math.max(...positiveX);
  const ec50Grid = logspace(xMinPos / 50, xMaxPos * 50, 50);
  const gammaGrid = estimateGamma ? logspace(0.25, 4, 13) : [1];

  let bestRss = Infinity;
  let bestEc50Idx = -1;
  let bestGammaIdx = -1;
  for (let gi = 0; gi < gammaGrid.length; gi++) {
    for (let ei = 0; ei < ec50Grid.length; ei++) {
      const r = rssAt(xs, ys, ec50Grid[ei]!, gammaGrid[gi]!, estimateE0);
      if (r && r.rss < bestRss) {
        bestRss = r.rss;
        bestEc50Idx = ei;
        bestGammaIdx = gi;
      }
    }
  }
  if (bestEc50Idx < 0) return null;

  let ec50 = ec50Grid[bestEc50Idx]!;
  let gamma = gammaGrid[bestGammaIdx]!;
  const rssForEc50 = (logEc50: number, g: number) => rssAt(xs, ys, Math.exp(logEc50), g, estimateE0)?.rss ?? Infinity;
  const rssForGamma = (e: number, logGamma: number) => rssAt(xs, ys, e, Math.exp(logGamma), estimateE0)?.rss ?? Infinity;

  const refineEc50 = (g: number) => {
    const lo = Math.log(ec50Grid[Math.max(bestEc50Idx - 1, 0)]!);
    const hi = Math.log(ec50Grid[Math.min(bestEc50Idx + 1, ec50Grid.length - 1)]!);
    return Math.exp(goldenSectionMin(lo, hi, (v) => rssForEc50(v, g)));
  };
  const refineGamma = (e: number) => {
    const lo = Math.log(gammaGrid[Math.max(bestGammaIdx - 1, 0)]!);
    const hi = Math.log(gammaGrid[Math.min(bestGammaIdx + 1, gammaGrid.length - 1)]!);
    return Math.exp(goldenSectionMin(lo, hi, (v) => rssForGamma(e, v)));
  };

  ec50 = refineEc50(gamma);
  if (estimateGamma) {
    gamma = refineGamma(ec50);
    ec50 = refineEc50(gamma);
    gamma = refineGamma(ec50);
  }

  const final = rssAt(xs, ys, ec50, gamma, estimateE0);
  if (!final) return null;

  // Boundary diagnostic: the golden-section refine only ever narrows within
  // the neighborhood of the COARSE grid's best index (it never searches past
  // ec50Grid[0]/[last] or gammaGrid[0]/[last]) — so a best index sitting AT
  // either edge means the unconstrained optimum wants to go further and the
  // search grid stopped it there. That is the honest signature of a poorly-
  // identified parameter (a flat or monotone-to-the-edge RSS surface), not a
  // numerical accident — surfaced to the caller rather than silently reported
  // as an ordinary point estimate.
  const ec50Boundary: "lower" | "upper" | null =
    bestEc50Idx === 0 ? "lower" : bestEc50Idx === ec50Grid.length - 1 ? "upper" : null;
  const gammaBoundary: "lower" | "upper" | null =
    estimateGamma ? (bestGammaIdx === 0 ? "lower" : bestGammaIdx === gammaGrid.length - 1 ? "upper" : null) : null;

  const paramOrder: ParamKey[] = [];
  if (estimateE0) paramOrder.push("e0");
  paramOrder.push("emax", "ec50");
  if (estimateGamma) paramOrder.push("gamma");
  const df = n - paramOrder.length;
  if (df < 1) return null;
  const sigma2 = final.rss / df;
  const sigma = Math.sqrt(sigma2);

  const params = { e0: final.e0, emax: final.emax, ec50, gamma };
  const cov = covarianceMatrix(xs, params, paramOrder, sigma2);

  return {
    e0: final.e0,
    emax: final.emax,
    ec50,
    gamma,
    estimateE0,
    estimateGamma,
    n,
    df,
    rss: final.rss,
    sigma,
    cov,
    paramOrder,
    ec50Boundary,
    gammaBoundary
  };
}

/** Numeric (central-difference) gradient of the mean function w.r.t. the
 * active parameters, at exposure `x`. Numeric rather than analytic to avoid
 * the x=0 / log(0) edge cases in the γ-derivative and keep every family's
 * math independently auditable without hand-verified calculus. */
function gradientAt(
  x: number,
  params: { e0: number; emax: number; ec50: number; gamma: number },
  order: ParamKey[]
): number[] {
  return order.map((key) => {
    const v = params[key];
    const h = Math.max(Math.abs(v) * 1e-4, 1e-6);
    const plus = { ...params, [key]: v + h };
    const minus = { ...params, [key]: v - h };
    return (meanAt(x, plus) - meanAt(x, minus)) / (2 * h);
  });
}

/** Solve A·X = I (n×n, n ≤ 4) via Gaussian elimination with partial pivoting,
 * one identity column at a time — the same small-system pattern as
 * `@er-explorer/model-loess`'s equivalent-kernel solve. Returns null if `A`
 * is singular (e.g. two parameters perfectly confounded on this cohort). */
function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const inv: number[][] = [];
  for (let col = 0; col < n; col++) {
    const rhs = Array.from({ length: n }, (_, i) => (i === col ? 1 : 0));
    const x = solveLinearSystem(a, rhs);
    if (!x) return null;
    inv.push(x);
  }
  // `inv` currently holds COLUMNS of the inverse as rows; transpose.
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => inv[c]![r]!));
}

function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const t = m[col]!;
      m[col] = m[piv]!;
      m[piv] = t;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / m[i]![i]!);
}

/** Gauss–Newton covariance Cov(θ) ≈ σ²·(JᵗJ)⁻¹ over the active parameters. */
function covarianceMatrix(
  xs: number[],
  params: { e0: number; emax: number; ec50: number; gamma: number },
  order: ParamKey[],
  sigma2: number
): number[][] {
  const p = order.length;
  const jtj: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (const x of xs) {
    const g = gradientAt(x, params, order);
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) jtj[a]![b]! += g[a]! * g[b]!;
    }
  }
  const inv = invert(jtj);
  if (!inv) return Array.from({ length: p }, () => new Array(p).fill(NaN));
  return inv.map((row) => row.map((v) => v * sigma2));
}

/** Point estimate + delta-method SE at one exposure. */
export function predictEmaxAt(fit: EmaxFit, x0: number): { estimate: number; se: number } {
  const estimate = meanAt(x0, fit);
  const g = gradientAt(x0, fit, fit.paramOrder);
  let variance = 0;
  for (let a = 0; a < g.length; a++) {
    for (let b = 0; b < g.length; b++) variance += g[a]! * fit.cov[a]![b]! * g[b]!;
  }
  return { estimate, se: Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : NaN };
}

/** Student-t 97.5th percentile (Cornish–Fisher expansion) — same closed form
 * `@er-explorer/model-loess` uses; duplicated rather than imported so each
 * model package stays dependency-free and independently auditable. */
export function tQuantile975(df: number): number {
  if (!Number.isFinite(df) || df <= 0) return NaN;
  const z = 1.959963984540054;
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  const g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
}

/** Batch predictions with a 95% pointwise delta-method band (estimate ± t·SE). */
export function predictEmax(fit: EmaxFit, exposures: number[]): EmaxPrediction[] {
  const t = tQuantile975(fit.df);
  return exposures.map((exposure) => {
    const { estimate, se } = predictEmaxAt(fit, exposure);
    const half = Number.isFinite(se) && Number.isFinite(t) ? t * se : NaN;
    return {
      exposure,
      estimate,
      lower: Number.isFinite(half) ? estimate - half : NaN,
      upper: Number.isFinite(half) ? estimate + half : NaN
    };
  });
}

/** Human-readable equation + parameter estimates (with SE) for display —
 * every model family exposes an equivalent describe function; the demo's
 * readout/tooltip switches on `EndpointFit.kind` to call the right one, the
 * same pattern already used for `fittedAt`. */
export function describeEmaxFit(fit: EmaxFit): {
  equation: string;
  params: Array<{ label: string; value: number; se?: number }>;
  warning?: string;
} {
  const e0Term = fit.estimateE0 ? "E0 + " : "";
  const hillTerm = fit.estimateGamma ? "x^γ / (EC50^γ + x^γ)" : "x / (EC50 + x)";
  const equation = `E = ${e0Term}Emax · ${hillTerm}`;
  const seOf = (key: ParamKey): number | undefined => {
    const idx = fit.paramOrder.indexOf(key);
    return idx >= 0 ? Math.sqrt(fit.cov[idx]![idx]!) : undefined;
  };
  const params: Array<{ label: string; value: number; se?: number }> = [];
  if (fit.estimateE0) params.push({ label: "E0", value: fit.e0, se: seOf("e0") });
  params.push({ label: "Emax", value: fit.emax, se: seOf("emax") });
  params.push({ label: "EC50", value: fit.ec50, se: seOf("ec50") });
  if (fit.estimateGamma) params.push({ label: "γ", value: fit.gamma, se: seOf("gamma") });

  const pinned: string[] = [];
  if (fit.ec50Boundary) pinned.push(`EC50 (${fit.ec50Boundary} edge)`);
  if (fit.gammaBoundary) pinned.push(`γ (${fit.gammaBoundary} edge)`);
  const warning = pinned.length
    ? `⚠ ${pinned.join(", ")} pinned to the search boundary — this cohort does not clearly identify a saturation point; treat the estimate with caution.`
    : undefined;

  return { equation, params, warning };
}
