/**
 * ADR-0013 model-family adapter contract (types only — implementations live with
 * the code that owns fitting, currently the demo; see `.ai/INVARIANTS.md` I7).
 *
 * Every selection/projection/callout/readout behavior is written ONCE over this
 * interface. Pipelines may not branch on family beyond selecting the adapter;
 * adding a family (Emax, ordinal, bounded smoother) means implementing this
 * interface and appearing in the conformance matrix — nothing else.
 */

/** Observed (model-free) summary of a group's responses, family-defined. */
export interface ObservedGroupSummary {
  center: number;
  lower: number;
  upper: number;
  n: number;
  /** e.g. "12/26" + "46%" for binary; "23.4" for continuous mean. */
  primaryLabel: string;
  secondaryLabel: string;
}

/**
 * One model family. `Model` is opaque to every pipeline — only the adapter's own
 * methods may interpret it.
 */
export interface EndpointFamilyAdapter<Model = unknown> {
  readonly familyId: string;
  /** Decimal places for fitted values in readouts/callouts. */
  readonly readoutDecimals: number;
  /** Point estimate of the fitted response at exposure x. */
  fittedAt(model: Model, x: number): number;
  /** Observed summary of raw responses (x/N Wilson for binary, mean±CI for continuous, P(Y≥k) set later for ordinal). */
  observedSummary(responses: number[]): ObservedGroupSummary | null;
}
