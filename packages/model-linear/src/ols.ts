/**
 * Ordinary least squares fit of a single-exposure linear exposure-response
 * model: `response = intercept + slope * exposure`, by closed-form normal
 * equations (no iterative optimization needed - see
 * `OptimizationSummary.algorithm` in the plugin, which reports this).
 */

/** Wald covariance matrix of (intercept, slope) implied by the residual variance - the same shape as the legacy logistic model's `LogisticCovariance`, reused here for the analogous linear-regression quantity. */
export interface LinearCovariance {
  /** Var(intercept) */
  b00: number;
  /** Cov(intercept, slope) */
  b01: number;
  /** Var(slope) */
  b11: number;
}

export interface LinearParams {
  /** Fitted value at exposure = 0. */
  intercept: number;
  /** Change in response per unit exposure. */
  slope: number;
  /** Number of observations used in the fit. */
  n: number;
  /** Residual degrees of freedom (n - 2). Confidence intervals need this for the t-distribution; diagnostics/CI code should treat a non-positive value as "undefined". */
  degreesOfFreedom: number;
  /** Residual standard error (sqrt of the residual mean square). NaN if degreesOfFreedom <= 0. */
  residualStandardError: number;
  /** Coefficient of determination. NaN if the response has zero variance. */
  rSquared: number;
  /** Wald covariance of (intercept, slope); null if it could not be estimated (e.g. degreesOfFreedom <= 0). */
  covariance: LinearCovariance | null;
  /** Mean of the fitted exposures - kept on the params since predictions' standard errors depend on distance from it. */
  meanExposure: number;
  /** Sum of squared deviations of exposure from its mean (`Sxx`) - kept on the params for the same reason. */
  sumSquaredExposureDeviations: number;
}

/**
 * Fit `responses ~ exposures` by OLS. Returns `null` if the data cannot
 * support a fit: fewer than 3 points (need at least 1 residual degree of
 * freedom to be meaningful), mismatched lengths, or zero variance in
 * `exposures` (a vertical line has no finite slope).
 */
export function fitLinearModel(exposures: number[], responses: number[]): LinearParams | null {
  const n = exposures.length;
  if (n < 3 || n !== responses.length) return null;

  const meanExposure = mean(exposures);
  const meanResponse = mean(responses);

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = exposures[i] - meanExposure;
    sxx += dx * dx;
    sxy += dx * (responses[i] - meanResponse);
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanResponse - slope * meanExposure;

  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slope * exposures[i];
    const residual = responses[i] - fitted;
    sse += residual * residual;
    const totalDeviation = responses[i] - meanResponse;
    sst += totalDeviation * totalDeviation;
  }

  const degreesOfFreedom = n - 2;
  const residualVariance = degreesOfFreedom > 0 ? sse / degreesOfFreedom : NaN;
  const residualStandardError = Math.sqrt(residualVariance);
  const rSquared = sst > 0 ? 1 - sse / sst : NaN;

  const covariance: LinearCovariance | null =
    degreesOfFreedom > 0 && isFinite(residualVariance)
      ? {
          b11: residualVariance / sxx,
          b01: (-residualVariance * meanExposure) / sxx,
          b00: residualVariance * (1 / n + (meanExposure * meanExposure) / sxx)
        }
      : null;

  return {
    intercept,
    slope,
    n,
    degreesOfFreedom,
    residualStandardError,
    rSquared,
    covariance,
    meanExposure,
    sumSquaredExposureDeviations: sxx
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
