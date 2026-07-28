import type {
  AnalysisModel,
  AnalysisModelCapabilities,
  ConfidenceInterval,
  ConfidenceIntervalRequest,
  Diagnostic,
  FitOutcome,
  FitRequest,
  PredictionContext,
  PredictionSurface
} from "@er-explorer/analysis";
import { bootstrapLinearConfidenceIntervals, waldLinearConfidenceIntervals } from "./confidenceIntervals";
import { fitLinearModel, type LinearParams } from "./ols";

/** Stable id of the exported plugin instance, reused in `PredictionSurface.analysisModelId` so a caller can trace a surface back to the model that produced it. */
export const LINEAR_ANALYSIS_MODEL_ID = "linear-ols-v1";

/** Drop any (exposure, response) pair where either side is missing/non-numeric, and coerce string-encoded numeric responses (as a raw upload column might provide) to numbers. */
function toNumericPairs(request: FitRequest): { exposures: number[]; responses: number[] } {
  const exposures: number[] = [];
  const responses: number[] = [];
  for (let i = 0; i < request.exposures.length; i++) {
    const x = request.exposures[i];
    const rawY = request.responses[i];
    const y = typeof rawY === "number" ? rawY : Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    exposures.push(x);
    responses.push(y);
  }
  return { exposures, responses };
}

const capabilities: AnalysisModelCapabilities = {
  confidenceIntervalMethods: ["wald", "bootstrap"],
  supportsCovariateAdjustment: false,
  requiresCensoringVariable: false
};

/** A degenerate LinearParams for when there isn't enough usable data to fit - keeps `fit` total (always returns a FitOutcome) rather than throwing, matching how the legacy logistic implementation signals an unfittable dataset via its own result shape rather than an exception. */
function unfittableParams(n: number): LinearParams {
  return {
    intercept: NaN,
    slope: NaN,
    n,
    degreesOfFreedom: n - 2,
    residualStandardError: NaN,
    rSquared: NaN,
    covariance: null,
    meanExposure: NaN,
    sumSquaredExposureDeviations: 0
  };
}

/**
 * The `"linear"` {@link AnalysisModel} plugin: single-predictor ordinary
 * least squares, for continuous endpoints (e.g. a rating-scale score like
 * `BRLS`/`PRLS`) - the exposure-response counterpart of the legacy
 * logistic model, but for a continuous rather than binary response, and
 * built against the new plugin architecture rather than living in
 * `packages/analysis` directly.
 *
 * There is no "responder"/"non-responder" concept for a continuous
 * endpoint - see `meanConfidenceInterval` (`statistics.ts`) for the
 * corresponding "observed mean, 95% CI, n contributing" summary a caller
 * would show instead of an observed responder rate.
 */
export const linearAnalysisModel: AnalysisModel<LinearParams> = {
  id: LINEAR_ANALYSIS_MODEL_ID,
  family: "linear",
  label: "Linear regression (ordinary least squares)",
  description:
    "Single-predictor OLS exposure-response fit for continuous endpoints, with Wald and bootstrap confidence intervals for the mean response.",
  capabilities,

  fit(request: FitRequest): FitOutcome<LinearParams> {
    const { exposures, responses } = toNumericPairs(request);
    const params = fitLinearModel(exposures, responses);

    if (!params) {
      return {
        params: unfittableParams(exposures.length),
        optimization: {
          algorithm: "ols-normal-equations",
          converged: false,
          warnings: ["Fewer than 3 usable observations, or zero variance in exposure; cannot fit a line."]
        }
      };
    }

    return {
      params,
      optimization: { algorithm: "ols-normal-equations", converged: true, objectiveValue: params.rSquared, iterations: 1 }
    };
  },

  predict(params: LinearParams, _context?: PredictionContext): PredictionSurface {
    return {
      analysisModelId: LINEAR_ANALYSIS_MODEL_ID,
      scale: "response",
      evaluate: (exposures: number[]) =>
        exposures.map((exposure) => ({ exposure, estimate: params.intercept + params.slope * exposure }))
    };
  },

  diagnose(params: LinearParams, _request?: FitRequest): Diagnostic[] {
    const diagnostics: Diagnostic[] = [
      { id: "converged", label: "Converged", severity: params.covariance ? "info" : "error", value: params.covariance ? 1 : 0 },
      { id: "r-squared", label: "R²", severity: "info", value: params.rSquared },
      { id: "residual-standard-error", label: "Residual standard error", severity: "info", value: params.residualStandardError },
      { id: "n", label: "N", severity: "info", value: params.n }
    ];
    if (!params.covariance) {
      diagnostics.push({
        id: "insufficient-data",
        label: "Insufficient data",
        severity: "error",
        message: "Fewer than 3 usable observations, or zero variance in exposure; standard errors are undefined."
      });
    }
    return diagnostics;
  },

  confidenceInterval(params: LinearParams, fitRequest: FitRequest, request: ConfidenceIntervalRequest): ConfidenceInterval[] {
    if (request.method === "bootstrap") {
      const { exposures, responses } = toNumericPairs(fitRequest);
      return bootstrapLinearConfidenceIntervals(exposures, responses, request.exposures, {
        resamples: request.bootstrap?.resamples,
        seed: request.bootstrap?.seed,
        level: request.level ?? request.bootstrap?.level
      });
    }
    return waldLinearConfidenceIntervals(params, request.exposures, request.level ?? 0.95);
  }
};
