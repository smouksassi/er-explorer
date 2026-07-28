/**
 * How a {@link Selection} came to be.
 *
 * Kept so the session/UI layer can explain and reproduce a selection (e.g.
 * re-applying the same brush programmatically when a {@link Session} is
 * reloaded) without `packages/domain` needing to know anything about
 * pixels, SVG, or pointer events.
 */
export type SelectionSource =
  | "brush"
  | "click"
  | "filter"
  | "programmatic"
  | "none";

/**
 * The set of analysis-unit (typically subject) records currently
 * highlighted or focused within an {@link Analysis}, independent of which
 * Variables or panels are being viewed.
 *
 * A `Selection` never changes what was fitted - it only changes what is
 * *highlighted or projected* on top of an existing {@link Prediction}. This
 * mirrors the demo app's brushing/dose-click behavior, which projects onto
 * a fixed fit rather than refitting on every interaction: the fit is a
 * property of the {@link AnalysisSpec} and {@link Question}, while the
 * Selection is purely a view-level focus.
 */
export interface Selection {
  /** Ids (typically subject ids, referencing rows of the StudyDataset) currently selected. An empty array means "nothing selected". */
  recordIds: string[];
  /** How this selection was produced. */
  source: SelectionSource;
  /** Id of the Variable whose value(s) define this selection, when the selection corresponds to a named group (e.g. a dose Covariate level) rather than an arbitrary brushed region. */
  groupingVariableId?: string;
  /** The specific level of `groupingVariableId` this selection represents (e.g. `"150 mg"`), when applicable. */
  groupingValue?: string;
  /** Free-text label for display (e.g. `"AUC in [45.2, 88.9]"` for a brush, or `"150 mg"` for a dose click). */
  label?: string;
}
