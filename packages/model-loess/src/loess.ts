/**
 * LOESS — local polynomial regression, matching R's `stats::loess` with
 * `family = "gaussian"` and `surface = "direct"` (exact local fits at every
 * query point; R's DEFAULT `surface = "interpolate"` approximates via a k-d
 * tree, so cross-checks in R should use
 * `loess(y ~ x, span, degree, control = loess.control(surface = "direct"))`).
 *
 * Fit at a query point x0 (degree d, span s, n training points):
 *   - neighborhood: q = min(n, ceil(s·n)) nearest xs by |xi − x0|;
 *     h = q-th smallest distance (for s > 1, h scaled by s^(1/d) as in R)
 *   - tricube weights w_i = (1 − (|xi − x0|/h)^3)^3 for |xi − x0| ≤ h
 *   - weighted least-squares polynomial of degree d centered at x0;
 *     the fitted value is the intercept: ŷ(x0) = l(x0)ᵀ y
 *
 * Standard errors (the ggquickeda recipe — `predict(fit, se = TRUE)` plus a
 * t multiplier): SE(x0) = s_res · ‖l(x0)‖ with s_res² = RSS / (n − tr(L)).
 * Fitted values match R exactly (same neighborhoods, weights, and normal
 * equations); the residual degrees of freedom use n − tr(L), a close, standard
 * approximation to R's one-/two-delta correction — bands may differ from R by
 * a few percent in small samples, values do not.
 *
 * No response clamping anywhere (user ruling, rethink round 2 §I.4): a
 * smoother on binary data may leave [0, 1]; the caller pads the axis.
 */

export interface LoessOptions {
  /** Neighborhood fraction, R default 0.75. */
  span?: number;
  /** Local polynomial degree (R default 2). */
  degree?: 1 | 2;
}

export interface LoessFit {
  kind: "loess";
  /** Training data, sorted by x (pairs kept aligned). */
  xs: number[];
  ys: number[];
  span: number;
  degree: 1 | 2;
  /** Residual scale s_res (NaN when residual df ≤ 0). */
  sigma: number;
  /** Residual degrees of freedom n − tr(L) for the t multiplier. */
  df: number;
  /** Equivalent number of parameters tr(L) (diagnostic). */
  enp: number;
}

export interface LoessPrediction {
  estimate: number;
  se: number;
}

/** Minimum honest support for a loess fit (unified minimum-support rule). */
export const LOESS_MIN_N = 5;

function solveSymmetric(a: number[][], b: number[]): number[] | null {
  // Gaussian elimination with partial pivoting on a small (≤3×3) system.
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

/**
 * The equivalent-kernel row l(x0): weights such that ŷ(x0) = Σ l_i · y_i.
 * Returns null when the local weighted design is singular (e.g. all
 * neighborhood xs identical under degree ≥ 1).
 */
function equivalentKernel(fit: Pick<LoessFit, "xs" | "span" | "degree">, x0: number): Float64Array | null {
  const { xs, span, degree } = fit;
  const n = xs.length;
  const q = Math.min(n, Math.ceil(span * n));

  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.abs(xs[i]! - x0);
  const sorted = [...dist].sort((a, b) => a - b);
  let h = sorted[q - 1]!;
  if (span > 1) h = sorted[n - 1]! * Math.pow(span, 1 / degree);
  if (h <= 0) h = Math.max(sorted[n - 1]!, 1e-12);

  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = dist[i]! / h;
    if (u < 1) {
      const c = 1 - u * u * u;
      w[i] = c * c * c;
    }
  }

  // Weighted normal equations for a polynomial in (x − x0): the intercept is
  // the fitted value at x0. Moments m_k = Σ w (x−x0)^k up to 2·degree.
  const p = degree + 1;
  const moments = new Float64Array(2 * degree + 1);
  for (let i = 0; i < n; i++) {
    if (w[i] === 0) continue;
    let t = w[i]!;
    const dx = xs[i]! - x0;
    for (let k = 0; k <= 2 * degree; k++) {
      moments[k]! += t;
      t *= dx;
    }
  }
  const ata: number[][] = [];
  for (let r = 0; r < p; r++) {
    ata.push([]);
    for (let c = 0; c < p; c++) ata[r]!.push(moments[r + c]!);
  }
  // First row of (XᵀWX)⁻¹: solve (XᵀWX) v = e1.
  const e1 = new Array(p).fill(0);
  e1[0] = 1;
  const v = solveSymmetric(ata, e1);
  if (!v) return null;

  const l = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (w[i] === 0) continue;
    let basis = 1;
    let acc = 0;
    const dx = xs[i]! - x0;
    for (let k = 0; k < p; k++) {
      acc += v[k]! * basis;
      basis *= dx;
    }
    l[i] = acc * w[i]!;
  }
  return l;
}

/**
 * Fit a loess smoother. Returns null below the minimum honest support
 * (unified minimum-support rule) or when the design is degenerate.
 */
export function fitLoess(xs: number[], ys: number[], options?: LoessOptions): LoessFit | null {
  const span = options?.span ?? 0.75;
  const degree = options?.degree ?? 2;
  const pairs = xs
    .map((x, i) => ({ x, y: ys[i]! }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  const n = pairs.length;
  if (n < LOESS_MIN_N) return null;
  const distinct = new Set(pairs.map((p) => p.x));
  if (distinct.size < degree + 2) return null;
  if (Math.ceil(span * n) < degree + 1) return null;

  const fx = pairs.map((p) => p.x);
  const fy = pairs.map((p) => p.y);
  const base = { xs: fx, span, degree } as const;

  // Residual scale: fitted values at the training xs give tr(L) (own leverage)
  // and the RSS in one pass.
  let trL = 0;
  let rss = 0;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const l = equivalentKernel(base, fx[i]!);
    if (!l) continue;
    ok++;
    trL += l[i]!;
    let yhat = 0;
    for (let j = 0; j < n; j++) yhat += l[j]! * fy[j]!;
    const r = fy[i]! - yhat;
    rss += r * r;
  }
  if (ok < n) return null;
  const df = n - trL;
  const sigma = df > 0 ? Math.sqrt(rss / df) : NaN;

  return { kind: "loess", xs: fx, ys: fy, span, degree, sigma, df, enp: trL };
}

/** Point prediction + SE at one exposure. NaN estimate when locally singular. */
export function predictLoessAt(fit: LoessFit, x0: number): LoessPrediction {
  const l = equivalentKernel(fit, x0);
  if (!l) return { estimate: NaN, se: NaN };
  let yhat = 0;
  let norm2 = 0;
  for (let i = 0; i < fit.xs.length; i++) {
    yhat += l[i]! * fit.ys[i]!;
    norm2 += l[i]! * l[i]!;
  }
  const se = Number.isFinite(fit.sigma) ? fit.sigma * Math.sqrt(norm2) : NaN;
  return { estimate: yhat, se };
}

/** Two-sided t quantile (0.975) via a standard approximation — adequate for CI multipliers. */
export function tQuantile975(df: number): number {
  if (!Number.isFinite(df) || df <= 0) return NaN;
  // Cornish–Fisher style expansion around the normal quantile.
  const z = 1.959963984540054;
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  const g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
}

/** Batch predictions with 95% pointwise band (estimate ± t·SE). */
export function predictLoess(
  fit: LoessFit,
  exposures: number[]
): Array<{ exposure: number; estimate: number; lower: number; upper: number }> {
  const t = tQuantile975(fit.df);
  return exposures.map((exposure) => {
    const { estimate, se } = predictLoessAt(fit, exposure);
    const half = Number.isFinite(se) && Number.isFinite(t) ? t * se : NaN;
    return {
      exposure,
      estimate,
      lower: Number.isFinite(half) ? estimate - half : NaN,
      upper: Number.isFinite(half) ? estimate + half : NaN
    };
  });
}
