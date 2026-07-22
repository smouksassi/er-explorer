export type ModelKind = "logistic" | "linear" | "ordinal" | "time-to-event";

export interface ModelDefinition {
  id: string;
  kind: ModelKind;
  description: string;
}

export interface FitResult {
  model: ModelDefinition;
  coefficients: Record<string, number>;
  statistics: Record<string, number>;
}

export interface PredictionRequest {
  exposures: Array<Record<string, number | string>>;
  covariates?: Record<string, number | string>;
}

export interface PredictionResult {
  estimates: Array<Record<string, number>>;
  metadata: Record<string, unknown>;
}

export const createModelDefinition = (id: string, kind: ModelKind, description: string): ModelDefinition => ({
  id,
  kind,
  description
});

export const createPredictionRequest = (exposures: Array<Record<string, number | string>>, covariates?: Record<string, number | string>): PredictionRequest => ({
  exposures,
  covariates
});

/* ---------------------------------------------------------------------- *
 * Logistic exposure-response model
 *
 * A single-exposure logistic regression fit by Newton-Raphson / IRLS,
 * with a small ridge penalty for numerical stability on separated or
 * near-separated data. Confidence intervals are available on the
 * probability scale via either a Wald approximation (delta method on the
 * linear predictor) or a nonparametric case-resampling bootstrap.
 * ---------------------------------------------------------------------- */

export interface LogisticCovariance {
  /** Var(intercept) */
  b00: number;
  /** Cov(intercept, slope) */
  b01: number;
  /** Var(slope) */
  b11: number;
}

export interface LogisticModel {
  /** intercept (log-odds at exposure = 0) */
  intercept: number;
  /** slope (log-odds per unit exposure) */
  slope: number;
  /** Wald covariance matrix of (intercept, slope); null if it could not be estimated */
  covariance: LogisticCovariance | null;
  /** number of observations used in the fit */
  n: number;
  /** number of responders (y = 1) */
  nResponders: number;
  /** log-likelihood at convergence */
  logLikelihood: number;
  /** iterations used */
  iterations: number;
  /** whether Newton-Raphson converged within tolerance */
  converged: boolean;
}

export interface FitLogisticOptions {
  /** L2 ridge penalty added to the Hessian for stability. Default 1e-6. */
  ridge?: number;
  /** maximum Newton-Raphson iterations. Default 50. */
  maxIterations?: number;
  /** convergence tolerance on the step size. Default 1e-8. */
  tolerance?: number;
}

export const sigmoid = (z: number): number => {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
};

/**
 * Fit a binary logistic exposure-response model: P(y=1) = sigmoid(b0 + b1 * x).
 * Returns null if the data cannot support a fit (fewer than 2 points, or a
 * single outcome class present).
 */
export function fitLogisticModel(
  exposures: number[],
  responses: number[],
  options: FitLogisticOptions = {}
): LogisticModel | null {
  const { ridge = 1e-6, maxIterations = 50, tolerance = 1e-8 } = options;
  const n = exposures.length;
  if (n < 2 || n !== responses.length) return null;

  const nResponders = responses.reduce((a, b) => a + b, 0);
  if (nResponders === 0 || nResponders === n) return null;

  let b0 = 0;
  let b1 = 0;
  let h00 = 0;
  let h01 = 0;
  let h11 = 0;
  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < maxIterations; iterations++) {
    let g0 = -ridge * b0;
    let g1 = -ridge * b1;
    h00 = -ridge;
    h01 = 0;
    h11 = -ridge;

    for (let i = 0; i < n; i++) {
      const x = exposures[i];
      const y = responses[i];
      const p = sigmoid(b0 + b1 * x);
      const w = Math.max(1e-9, p * (1 - p));
      g0 += y - p;
      g1 += (y - p) * x;
      h00 -= w;
      h01 -= w * x;
      h11 -= w * x * x;
    }

    const det = h00 * h11 - h01 * h01;
    if (!isFinite(det) || Math.abs(det) < 1e-12) break;

    const step0 = (g0 * h11 - g1 * h01) / det;
    const step1 = (h00 * g1 - h01 * g0) / det;
    b0 -= step0;
    b1 -= step1;

    if (!isFinite(b0) || !isFinite(b1)) return null;
    if (Math.max(Math.abs(step0), Math.abs(step1)) < tolerance) {
      converged = true;
      iterations++;
      break;
    }
  }

  let logLikelihood = 0;
  for (let i = 0; i < n; i++) {
    const p = sigmoid(b0 + b1 * exposures[i]);
    const clamped = Math.min(1 - 1e-12, Math.max(1e-12, p));
    logLikelihood += responses[i] * Math.log(clamped) + (1 - responses[i]) * Math.log(1 - clamped);
  }

  // Observed information is -Hessian; invert to get the Wald covariance.
  const a = -h00;
  const b = -h01;
  const c = -h11;
  const det = a * c - b * b;
  const covariance: LogisticCovariance | null =
    !isFinite(det) || Math.abs(det) < 1e-12
      ? null
      : { b00: c / det, b01: -b / det, b11: a / det };

  return { intercept: b0, slope: b1, covariance, n, nResponders, logLikelihood, iterations, converged };
}

export function toFitResult(model: LogisticModel, definition: ModelDefinition): FitResult {
  return {
    model: definition,
    coefficients: { intercept: model.intercept, slope: model.slope },
    statistics: {
      n: model.n,
      nResponders: model.nResponders,
      logLikelihood: model.logLikelihood,
      iterations: model.iterations,
      converged: model.converged ? 1 : 0,
      seIntercept: model.covariance ? Math.sqrt(Math.max(0, model.covariance.b00)) : NaN,
      seSlope: model.covariance ? Math.sqrt(Math.max(0, model.covariance.b11)) : NaN
    }
  };
}

const Z_95 = 1.959963984540054;

const zForLevel = (level: number): number => {
  // Good enough approximation for the levels this app exposes (0.80-0.99);
  // exact for the default 0.95 case.
  if (Math.abs(level - 0.95) < 1e-9) return Z_95;
  // Inverse-normal via Acklam's rational approximation.
  const p = 1 - (1 - level) / 2;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
};

export interface PointEstimate {
  exposure: number;
  estimate: number;
  lower: number;
  upper: number;
}

/** Wald (delta-method) confidence interval on the probability scale. */
export function predictLogisticWald(model: LogisticModel, exposures: number[], level = 0.95): PointEstimate[] {
  const z = zForLevel(level);
  return exposures.map((x) => {
    const eta = model.intercept + model.slope * x;
    const estimate = sigmoid(eta);
    if (!model.covariance) return { exposure: x, estimate, lower: NaN, upper: NaN };
    const { b00, b01, b11 } = model.covariance;
    const seEta = Math.sqrt(Math.max(0, b00 + 2 * x * b01 + x * x * b11));
    return {
      exposure: x,
      estimate,
      lower: sigmoid(eta - z * seEta),
      upper: sigmoid(eta + z * seEta)
    };
  });
}

export function predictLogisticWaldResult(model: LogisticModel, exposures: number[], level = 0.95): PredictionResult {
  const points = predictLogisticWald(model, exposures, level);
  return {
    estimates: points.map((p) => ({ exposure: p.exposure, estimate: p.estimate, lower: p.lower, upper: p.upper })),
    metadata: { method: "wald", level }
  };
}

/** Deterministic PRNG (mulberry32) so bootstrap results are reproducible from a session seed. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapOptions {
  resamples?: number;
  level?: number;
  seed?: number;
  ridge?: number;
}

/**
 * Nonparametric case-resampling bootstrap CI for the fitted probability at
 * each requested exposure. Resamples (x, y) pairs with replacement, refits
 * the logistic model, and takes the percentile interval of predictions.
 * Uses a seeded PRNG so the result is exactly reproducible from the seed
 * stored in a session file (see docs/REPRODUCIBILITY.md).
 */
export function bootstrapLogisticCI(
  exposures: number[],
  responses: number[],
  atExposures: number[],
  options: BootstrapOptions = {}
): PredictionResult {
  const { resamples = 300, level = 0.95, seed = 12345, ridge } = options;
  const n = exposures.length;
  const rand = createSeededRandom(seed);
  const draws: number[][] = atExposures.map(() => []);

  let successfulResamples = 0;
  for (let b = 0; b < resamples; b++) {
    const xs: number[] = new Array(n);
    const ys: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rand() * n);
      xs[i] = exposures[idx];
      ys[i] = responses[idx];
    }
    const model = fitLogisticModel(xs, ys, { ridge });
    if (!model) continue;
    successfulResamples++;
    atExposures.forEach((x, j) => {
      draws[j].push(sigmoid(model.intercept + model.slope * x));
    });
  }

  const alpha = 1 - level;
  const estimates = atExposures.map((x, j) => {
    const sorted = draws[j].slice().sort((a, c) => a - c);
    return {
      exposure: x,
      estimate: quantile(sorted, 0.5),
      lower: quantile(sorted, alpha / 2),
      upper: quantile(sorted, 1 - alpha / 2)
    };
  });

  return {
    estimates,
    metadata: { method: "bootstrap", level, seed, resamples, successfulResamples }
  };
}

/* ---------------------------------------------------------------------- *
 * Distribution summaries (used for exposure boxplots / exposure-by-tile
 * observed-response summaries)
 * ---------------------------------------------------------------------- */

export function quantile(sortedAscending: number[], p: number): number {
  const n = sortedAscending.length;
  if (!n) return NaN;
  const i = (n - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sortedAscending[lo];
  return sortedAscending[lo] + (sortedAscending[hi] - sortedAscending[lo]) * (i - lo);
}

export interface ProportionCI {
  proportion: number;
  lower: number;
  upper: number;
  n: number;
  successes: number;
}

/**
 * Wilson score interval for a binomial proportion. Used for "observed" response-rate markers
 * (e.g. percent of responders within a dose/exposure bin) - more reliable than the normal
 * (Wald) approximation at small n or when the proportion sits near 0 or 1, both of which happen
 * routinely in dose-response bins (a small high-dose group with a very high response rate, etc).
 */
export function wilsonScoreInterval(successes: number, n: number, z = 1.959963984540054): ProportionCI {
  if (n <= 0) return { proportion: NaN, lower: NaN, upper: NaN, n, successes };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const halfWidth = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    proportion: p,
    lower: Math.max(0, (center - halfWidth) / denom),
    upper: Math.min(1, (center + halfWidth) / denom),
    n,
    successes
  };
}

export interface DistributionSummary {
  n: number;
  min: number;
  max: number;
  mean: number;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

export function summarizeDistribution(values: number[]): DistributionSummary | null {
  if (!values.length) return null;
  const arr = values.slice().sort((a, b) => a - b);
  const q1 = quantile(arr, 0.25);
  const median = quantile(arr, 0.5);
  const q3 = quantile(arr, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLow = arr.find((v) => v >= lowerFence) ?? arr[0];
  const whiskerHigh = [...arr].reverse().find((v) => v <= upperFence) ?? arr[arr.length - 1];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const outliers = arr.filter((v) => v < lowerFence || v > upperFence);
  return { n: arr.length, min: arr[0], max: arr[arr.length - 1], mean, q1, median, q3, whiskerLow, whiskerHigh, outliers };
}

/* ---------------------------------------------------------------------- *
 * Kernel density estimation (used to render exposure distributions as
 * violins/densities as an alternative to boxplots)
 * ---------------------------------------------------------------------- */

/** Silverman's rule-of-thumb bandwidth for Gaussian KDE. */
export function silvermanBandwidth(values: number[]): number {
  const n = values.length;
  if (n < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const sorted = values.slice().sort((a, b) => a - b);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  const sigma = spread > 0 && isFinite(spread) ? spread : sd || 1;
  const h = 0.9 * sigma * Math.pow(n, -0.2);
  return h > 0 && isFinite(h) ? h : 1;
}

/**
 * Gaussian kernel density estimate of `values`, evaluated at `evalPoints`.
 * Bandwidth defaults to Silverman's rule of thumb if not provided.
 */
export function kernelDensityEstimate(values: number[], evalPoints: number[], bandwidth?: number): number[] {
  if (!values.length) return evalPoints.map(() => 0);
  const h = bandwidth ?? silvermanBandwidth(values);
  const n = values.length;
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return evalPoints.map((x) => {
    let sum = 0;
    for (const v of values) {
      const z = (x - v) / h;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum * norm;
  });
}
