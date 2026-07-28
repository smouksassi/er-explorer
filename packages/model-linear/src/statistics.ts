/**
 * Small, dependency-free statistical helpers this plugin needs on top of
 * plain OLS coefficients: a normal-quantile approximation (for large-sample
 * Wald intervals), a Student's-t quantile approximation (for the
 * regression's own residual-based confidence bands, which have finite
 * degrees of freedom even when the sample is large), and a confidence
 * interval for a plain group mean.
 *
 * Deliberately self-contained rather than importing from
 * `@er-explorer/analysis`'s deprecated `legacyStatistics.ts` - a plugin
 * shouldn't reach into another plugin's (or legacy code's) internals; a
 * few dozen lines of well-known approximations duplicated here is a small,
 * worthwhile cost for keeping plugins independent.
 */

const Z_95 = 1.959963984540054;

/** Approximate the standard normal quantile (inverse CDF) at `level` (e.g. 0.95 -> ~1.96), via Acklam's rational approximation. Exact for the common 0.95 case. */
export function zForLevel(level: number): number {
  if (Math.abs(level - 0.95) < 1e-9) return Z_95;
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
}

/**
 * Approximate the Student's-t quantile at `level` with `degreesOfFreedom`,
 * via a Cornish-Fisher expansion around the normal quantile. Accurate to a
 * few parts in a thousand for df >= ~10, which covers every dose-group or
 * exposure-split sample size this application deals with; falls back to
 * the normal quantile itself when `degreesOfFreedom` is not finite/positive
 * (matching a t distribution's limiting behavior as df -> infinity).
 */
export function tQuantile(degreesOfFreedom: number, level: number): number {
  const z = zForLevel(level);
  if (!isFinite(degreesOfFreedom) || degreesOfFreedom <= 0) return z;
  const df = degreesOfFreedom;
  const z3 = z * z * z;
  const z5 = z3 * z * z;
  const term1 = (z3 + z) / (4 * df);
  const term2 = (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
  return z + term1 + term2;
}

/** A confidence interval for a plain group mean - the continuous-endpoint counterpart of a Wilson score interval for a proportion: instead of "% responders, n", a continuous endpoint reports "mean response, 95% CI, n contributing". */
export interface MeanConfidenceInterval {
  mean: number;
  lower: number;
  upper: number;
  /** Sample standard deviation (0 if n <= 1). */
  standardDeviation: number;
  /** Number of (non-missing) values the mean was computed from. */
  n: number;
}

/** Compute a t-based confidence interval for the mean of `values`. */
export function meanConfidenceInterval(values: number[], level = 0.95): MeanConfidenceInterval {
  const n = values.length;
  if (n === 0) return { mean: NaN, lower: NaN, upper: NaN, standardDeviation: NaN, n: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, lower: mean, upper: mean, standardDeviation: 0, n: 1 };

  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  const standardDeviation = Math.sqrt(variance);
  const standardError = standardDeviation / Math.sqrt(n);
  const t = tQuantile(n - 1, level);

  return { mean, lower: mean - t * standardError, upper: mean + t * standardError, standardDeviation, n };
}
