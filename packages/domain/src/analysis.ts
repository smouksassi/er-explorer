import type { Question } from "./question";
import type { AnalysisSpec } from "./analysisSpec";
import type { Prediction } from "./prediction";

/**
 * A minimal, rendering-agnostic description of how an {@link Analysis}'s
 * {@link Prediction} should be visualized.
 *
 * This is deliberately not the rich runtime spec consumed by
 * `packages/visualization-engine`. `packages/domain` is the project's root
 * dependency and must not import from any visualization, rendering, or UI
 * package, so this interface records only the scientifically/analytically
 * meaningful choices - which layout, which optional overlays are on - as
 * plain data. Translating this into an actual renderable spec (colors,
 * pixel geometry, SVG) is the responsibility of a higher-level package that
 * depends on `packages/domain`, not the other way around.
 */
export interface AnalysisVisualizationConfig {
  /** Which layout this analysis should render as (e.g. `"exposure-response-grid"`, `"compare-endpoints"`). */
  layout: string;
  /** Whether raw per-subject scatter points are shown alongside the fitted curve. */
  showPoints: boolean;
  /** Whether fitted-probability + CI markers are shown at each stratification split line. */
  showFittedMarkers: boolean;
  /** Whether observed (non-model) response-rate markers are shown at each stratification split bin. */
  showObservedMarkers: boolean;
  /** Display mode for the paired exposure-distribution panel. */
  distributionMode: "boxplot" | "distribution" | "lineranges" | "none";
  /** Free-form additional display options not yet promoted to a named field above. */
  extra?: Record<string, unknown>;
}

/**
 * One complete scientific analysis within a {@link Workspace}: a
 * {@link Question} asked, the {@link AnalysisSpec} (model) used to answer
 * it, the resulting {@link Prediction}, and how it is currently being
 * visualized.
 *
 * `Analysis` is the unit a scientist saves, revisits, compares against
 * other analyses, and exports - the top-level realization of ER Explorer's
 * core pipeline: Dataset -> Question -> Model -> Prediction ->
 * Visualization -> Decision (`docs/ARCHITECTURE.md`).
 *
 * An `Analysis` may exist with `prediction` unset - a Question and
 * AnalysisSpec have been defined but not yet fit/run - which is why
 * `prediction` is optional rather than required.
 */
export interface Analysis {
  /** Stable identifier within a Workspace. */
  id: string;
  /** Human-readable name (e.g. `"AUC vs ICGI, logistic, bootstrap CI"`). */
  name: string;
  /** The scientific question this analysis answers. */
  question: Question;
  /** The model specification used (or to be used) to answer the question. */
  model: AnalysisSpec;
  /** The fitted result, once computed. Absent for a defined-but-not-yet-run analysis. */
  prediction?: Prediction;
  /** How this analysis's prediction is currently rendered. */
  visualizationConfig: AnalysisVisualizationConfig;
  /** ISO-8601 timestamp this analysis was created. */
  createdAt: string;
  /** ISO-8601 timestamp this analysis was last modified. */
  updatedAt: string;
  /** Free-text scientific notes specific to this analysis (interpretation, caveats, follow-up questions). */
  notes?: string;
}
