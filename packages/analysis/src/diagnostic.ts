/** How seriously a {@link Diagnostic} should be treated - mirrors the levels a UI would use to color/prioritize a list of them, without this package knowing anything about UI. */
export type DiagnosticSeverity = "info" | "warning" | "error";

/**
 * One diagnostic finding about a fitted {@link AnalysisModel} - a
 * convergence flag, a goodness-of-fit statistic, a warning about
 * near-separation, a residual pattern, and so on.
 *
 * Deliberately generic: `packages/analysis` defines the shape every model
 * plugin reports diagnostics in, not which diagnostics exist - a logistic
 * plugin might report convergence and log-likelihood, a Cox plugin might
 * report a proportional-hazards test, and an Emax plugin might report
 * parameter identifiability warnings, all as `Diagnostic[]`.
 */
export interface Diagnostic {
  /** Stable identifier for this diagnostic within a model family (e.g. `"converged"`, `"log-likelihood"`, `"near-separation"`). */
  id: string;
  /** Human-readable label (e.g. `"Converged"`, `"Log-likelihood"`). */
  label: string;
  severity: DiagnosticSeverity;
  /** Numeric value, when this diagnostic is a statistic rather than a flag (e.g. a log-likelihood or a test statistic). */
  value?: number;
  /** Human-readable explanation, especially for `"warning"`/`"error"` severities. */
  message?: string;
  /** Free-form supporting detail (e.g. a per-parameter breakdown), left as plain data so it stays serializable. */
  details?: Record<string, unknown>;
}
