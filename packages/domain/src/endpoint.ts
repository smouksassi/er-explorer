import type { Variable } from "./variable";

/**
 * The statistical family of response an {@link Endpoint} requires.
 *
 * This determines which model families in an {@link AnalysisSpec} are
 * scientifically valid for the endpoint (e.g. a `"binary"` endpoint pairs
 * with a logistic model; `"time-to-event"` requires survival/hazard
 * modeling and explicit censoring handling). `packages/domain` records this
 * information but does not itself enforce the pairing - that validation, if
 * any, belongs to a higher layer.
 */
export type EndpointKind = "binary" | "continuous" | "ordinal" | "count" | "time-to-event";

/**
 * Which direction of change in an {@link Endpoint} represents clinical
 * benefit.
 *
 * Needed so ER Explorer can consistently phrase and color "improvement"
 * across endpoints scored in opposite directions - e.g. a symptom severity
 * score where lower is better vs. a responder rate where higher is better.
 */
export type EndpointDirectionality = "higher-is-better" | "lower-is-better" | "not-applicable";

/**
 * For a binary or ordinal clinical endpoint derived by thresholding a raw
 * score (e.g. an ICGI response defined as a >=2-point improvement), the
 * rule that defines "responder".
 *
 * Kept explicit and structured so the derivation is auditable rather than
 * baked silently into the data - a reviewer or collaborator can see exactly
 * how a responder flag was constructed from its source variable.
 */
export interface ResponderDefinition {
  /** Human-readable statement of the responder rule (e.g. `"CGI-Improvement score of 1 or 2"`). */
  description: string;
  /** Id of the raw (typically ordinal or continuous) Variable this responder flag was derived from, if any. */
  derivedFromVariableId?: string;
  /** Threshold value used in the derivation, when the rule is a simple cutpoint. */
  threshold?: number;
  /** Comparison operator the threshold is applied with. */
  comparator?: "<" | "<=" | ">" | ">=" | "=";
}

/**
 * A clinical response/outcome variable - the "response" side of an
 * exposure-response question.
 *
 * `Endpoint` specializes {@link Variable} with the clinical-trial metadata
 * (responder definition, directionality, assessment timing) needed to
 * correctly fit and interpret an exposure-response relationship. A
 * {@link Question} may select more than one `Endpoint` at once
 * ({@link Question.endpointIds}) to compare how the same exposure metric
 * relates to several outcomes side by side (mirrored in the demo app's
 * "Compare Endpoints" view).
 */
export interface Endpoint extends Variable {
  role: "endpoint";
  /** Statistical family this endpoint belongs to. */
  endpointKind: EndpointKind;
  /** Which direction of change represents clinical benefit. */
  directionality: EndpointDirectionality;
  /** For a derived binary/ordinal responder endpoint, the rule that defines a responder. */
  responderDefinition?: ResponderDefinition;
  /** Visit, week, or timepoint this endpoint was assessed at (e.g. `"Week 8"`), for endpoints assessed at a fixed time rather than modeled as time-to-event. */
  timepoint?: string;
  /** For a time-to-event endpoint, the id of the companion Variable holding the censoring indicator. */
  censoringVariableId?: string;
}
