import type { StudyDataset } from "./studyDataset";
import type { Analysis } from "./analysis";

/**
 * A single dated, attributed scientific note attached to a
 * {@link Workspace} - ER Explorer's lightweight electronic lab notebook,
 * capturing reasoning and decisions that live alongside the data rather
 * than in a separate document that can drift out of sync.
 */
export interface NoteEntry {
  /** Stable identifier within the Workspace. */
  id: string;
  /** Note body (plain text or lightweight markdown). */
  text: string;
  /** Who wrote the note. */
  author: string;
  /** ISO-8601 timestamp the note was created. */
  createdAt: string;
  /** Id of the Analysis this note refers to, if it is scoped to one rather than to the Workspace as a whole. */
  analysisId?: string;
}

/**
 * A record of a single export event - e.g. a figure exported for a
 * publication, or a session file shared with a collaborator.
 *
 * Kept so a {@link Workspace} can answer "what has left this project, in
 * what form, when, and derived from which Analysis" for publication and
 * regulatory traceability.
 */
export interface ExportRecord {
  /** Stable identifier within the Workspace. */
  id: string;
  /** What was exported (e.g. `"svg-figure"`, `"session-file"`, `"csv-summary"`, `"pdf-report"`). */
  kind: string;
  /** Id of the Analysis this export was derived from. */
  analysisId: string;
  /** ISO-8601 timestamp of the export. */
  exportedAt: string;
  /** Who performed the export. */
  exportedBy: string;
  /** Destination or filename the export was written to, if known (e.g. `"figure1_auc_icgi.svg"`). */
  destination?: string;
}

/**
 * Descriptive metadata about a {@link Workspace} itself, as distinct from
 * its scientific contents (dataset, analyses, notes, exports).
 */
export interface WorkspaceMetadata {
  /** Human-readable project name (e.g. `"Compound X Phase II ER analysis"`). */
  name: string;
  /** Free-text description of the project's scientific purpose. */
  description?: string;
  /** Who owns/created this workspace. */
  owner?: string;
  /** ISO-8601 timestamp the workspace was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent change to the workspace (dataset, any analysis, note, or export). */
  updatedAt: string;
  /** ER Explorer application version this workspace was last saved with, for forward/backward-compatibility handling. */
  appVersion?: string;
}

/**
 * The top-level scientific project in ER Explorer: one {@link StudyDataset}
 * plus every {@link Analysis} performed against it, the running notebook of
 * notes, and a history of what has been exported from it.
 *
 * A `Workspace` is the unit a scientist opens, works in, and eventually
 * hands off or archives. A {@link Session} is a small, reproducible
 * snapshot *of* a Workspace (which analysis was active, what was selected),
 * not the Workspace's full contents - see `session.ts`.
 */
export interface Workspace {
  /** Stable identifier for this workspace. */
  id: string;
  /** The canonical dataset this workspace's analyses are performed against. */
  dataset: StudyDataset;
  /** Every analysis performed in this workspace. */
  analyses: Analysis[];
  /** The running scientific notebook for this workspace. */
  notes: NoteEntry[];
  /** History of everything exported from this workspace. */
  exportHistory: ExportRecord[];
  /** Descriptive metadata about the workspace itself. */
  metadata: WorkspaceMetadata;
}
