import type { ConfidenceInterval } from "@er-explorer/analysis";
import { createSeededRandom, quantile } from "./prng";
import type { LinearParams } from "./ols";
import { fitLinearModel } from "./ols";
import { tQuantile } from "./statistics";

/**
 * Wald confidence interval for the *mean* response at each exposure (the
 * classic `geom_smooth(method = "lm")` ribbon: uncertainty in the fitted
 * line itself, not a prediction interval for a new individual observation).
 * Standard error at exposure `x` is
 * `sqrt(Var(intercept) + 2x*Cov(intercept,slope) + x^2*Var(slope))`,
 * combined with a t (not normal) quantile since the residual variance
 * itself is estimated with finite degrees of freedom.
 */
export function waldLinearConfidenceIntervals(params: LinearParams, exposures: number[], level = 0.95): ConfidenceInterval[] {
  const t = tQuantile(params.degreesOfFreedom, level);
  return exposures.map((exposure) => {
    const estimate = params.intercept + params.slope * exposure;
    if (!params.covariance) return { exposure, method: "wald", level, lower: NaN, upper: NaN };
    const { b00, b01, b11 } = params.covariance;
    const standardError = Math.sqrt(Math.max(0, b00 + 2 * exposure * b01 + exposure * exposure * b11));
    return {
      exposure,
      method: "wald",
      level,
      lower: estimate - t * standardError,
      upper: estimate + t * standardError
    };
  });
}

export interface BootstrapLinearOptions {
  resamples?: number;
  level?: number;
  seed?: number;
}

/**
 * Nonparametric case-resampling bootstrap CI for the fitted mean response
 * at each requested exposure: resamples (x, y) pairs with replacement,
 * refits OLS, and takes the percentile interval of the refit line's
 * predictions. Uses a seeded PRNG so the result is exactly reproducible
 * from a session's stored bootstrap seed (`docs/REPRODUCIBILITY.md`),
 * mirroring the legacy logistic model's `bootstrapLogisticCI`.
 */
export function bootstrapLinearConfidenceIntervals(
  exposures: number[],
  responses: number[],
  atExposures: number[],
  options: BootstrapLinearOptions = {}
): ConfidenceInterval[] {
  const { resamples = 300, level = 0.95, seed = 12345 } = options;
  const n = exposures.length;
  const rand = createSeededRandom(seed);
  const draws: number[][] = atExposures.map(() => []);

  for (let b = 0; b < resamples; b++) {
    const xs: number[] = new Array(n);
    const ys: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rand() * n);
      xs[i] = exposures[idx];
      ys[i] = responses[idx];
    }
    const refit = fitLinearModel(xs, ys);
    if (!refit) continue;
    atExposures.forEach((x, j) => {
      draws[j].push(refit.intercept + refit.slope * x);
    });
  }

  const alpha = 1 - level;
  return atExposures.map((exposure, j) => {
    const sorted = draws[j].slice().sort((a, c) => a - c);
    return {
      exposure,
      method: "bootstrap",
      level,
      lower: quantile(sorted, alpha / 2),
      upper: quantile(sorted, 1 - alpha / 2)
    };
  });
}
