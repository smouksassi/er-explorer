/**
 * Unified minimum-support rule (user ruling 2026-08-31): every displayed
 * statistic declares its minimum support; below it, the statistic ABSTAINS and
 * the raw data stays on screen. Nothing is fabricated, nothing silently
 * degrades. These constants and the tier function are the ONE place the
 * thresholds live — enforcement happens at the central stat seams
 * (summarizeDistribution, the dist shape builder, the selection pipeline,
 * tryFitForCohort, the readout), never per painter (invariant I7/I11).
 *
 * Abstention encoding: a summary below full support carries NaN in its
 * quartile/whisker fields. Geometry layers skip non-finite markers, so a
 * forgotten consumer draws NOTHING rather than a fabricated quantile.
 */

/** Minimum N for quartiles/box/violin/five-number summaries. */
export const MIN_SUMMARY_N = 5;

/**
 * Minimum endpoint-finite N for fitting any model family's curve. A fit whose
 * exposure support is a single value still renders as the P1 degenerate point
 * marker, never a line — so ">1 distinct x for a LINE" is structural, not a
 * second threshold. (model-loess enforces its own matching LOESS_MIN_N = 5
 * internally; the package is dependency-free by design.)
 */
export const MIN_FIT_N = 5;

/**
 * Support tier of a statistic over n observations:
 * - "full"    (n ≥ MIN_SUMMARY_N): five-number summary, box/violin, quartile markers.
 * - "minimal" (2 ≤ n < MIN_SUMMARY_N): Min · Median · Max only; raw points instead of shapes.
 * - "single"  (n = 1): the single value only.
 * n ≤ 0 never reaches a tier — producers return null for empty input.
 */
export type SupportTier = "full" | "minimal" | "single";

export function supportTierFor(n: number): SupportTier {
  if (n >= MIN_SUMMARY_N) return "full";
  return n >= 2 ? "minimal" : "single";
}
