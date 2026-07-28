import type { ModelFamily } from "@er-explorer/domain";
import type { AnalysisModel } from "./analysisModel";

/**
 * The plugin registry contract for {@link AnalysisModel}s - how
 * `packages/analysis` "designs for plugins": a `ModelRegistry` is where a
 * logistic, linear, Emax, ordinal, Kaplan-Meier, Cox, or Clinical Utility
 * plugin (or several competing implementations of the same family) gets
 * registered, looked up by id, or listed by `@er-explorer/domain`
 * `ModelFamily` so a caller (e.g. a future UI's model picker) can offer
 * whichever models are actually available.
 *
 * A pure interface, matching the rest of this package's new surface - no
 * concrete in-memory/persistent implementation ships here yet, and none of
 * today's legacy logistic code (`legacyStatistics.ts`) is registered
 * against it.
 */
export interface ModelRegistry {
  /** Register a plugin. Implementations should reject a duplicate `id`. */
  register(model: AnalysisModel): void;
  /** Remove a previously registered plugin by id. A no-op if it isn't registered. */
  unregister(modelId: string): void;
  /** Look up a plugin by id. */
  get(modelId: string): AnalysisModel | undefined;
  /** Every plugin registered for a given model family, e.g. every competing logistic implementation. */
  listByFamily(family: ModelFamily): AnalysisModel[];
  /** Every registered plugin, across all families. */
  list(): AnalysisModel[];
}
