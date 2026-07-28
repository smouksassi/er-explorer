/**
 * The kind of change a {@link HistoryEntry} records.
 *
 * Kept as an open-ended string union rather than an exhaustive one so a UI
 * layer can introduce new action kinds without requiring a
 * `packages/session-engine` release; `"custom"` covers anything not yet
 * promoted to a named kind.
 */
export type HistoryActionKind =
  | "create-analysis"
  | "update-question"
  | "update-model"
  | "update-selection"
  | "update-visualization"
  | "update-theme"
  | "update-panels"
  | "import"
  | "export"
  | "custom";

/**
 * One entry in a session's append-only action log.
 *
 * `History` exists for two purposes: an audit trail of what changed in a
 * session and when (useful alongside `Workspace.exportHistory` for
 * regulatory/publication traceability), and a substrate a UI layer can
 * build undo/redo on top of, using `before`/`after` as opaque snapshots of
 * whatever changed. `packages/session-engine` does not interpret `before`/
 * `after` itself - it only requires them to be plain, JSON-serializable
 * data, consistent with the rest of this package.
 */
export interface HistoryEntry {
  /** Stable identifier for this entry. */
  id: string;
  /** What kind of change this entry records. */
  actionKind: HistoryActionKind;
  /** Human-readable description (e.g. `"Switched CI method to bootstrap"`). */
  description: string;
  /** ISO-8601 timestamp the change was made. */
  timestamp: string;
  /** Id of the Analysis this change applies to, if scoped to one. */
  analysisId?: string;
  /** Opaque, plain-data snapshot of the relevant state before the change, for undo. */
  before?: unknown;
  /** Opaque, plain-data snapshot of the relevant state after the change, for redo. */
  after?: unknown;
}
