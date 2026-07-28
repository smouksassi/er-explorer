import type { Selection } from "./selection";

/**
 * Information needed to judge whether a {@link Session} can still be
 * exactly reproduced against the current state of its {@link Workspace}
 * and dataset.
 *
 * If, for example, the dataset's checksum has changed since the session
 * was saved, reloading it should warn rather than silently produce a
 * different result (`docs/REPRODUCIBILITY.md`).
 */
export interface ReproducibilityInfo {
  /** ER Explorer application version the session was saved with. */
  appVersion: string;
  /** Checksum of the StudyDataset at the time this session was saved (see DatasetProvenance.checksum). */
  datasetChecksum?: string;
  /** Version of the statistical engine used to compute any Predictions captured in this session. */
  statisticalEngineVersion?: string;
}

/**
 * A saved, reloadable snapshot of a scientist's exact place in a
 * {@link Workspace} - which {@link Analysis} was active, what was
 * selected, and enough version/checksum information to judge whether
 * reloading it will reproduce the same result.
 *
 * This realizes the reproducibility principle that every analysis is
 * recoverable from a session file (`docs/REPRODUCIBILITY.md`,
 * ADR: "every analysis is reproduced via session files"). A `Session` is
 * intentionally small: it does not duplicate the Workspace's dataset or
 * full analysis history, only a pointer into it plus the transient,
 * view-level state ({@link Selection}) that is not otherwise persisted on
 * the Analysis itself.
 */
export interface Session {
  /** Stable identifier for this saved session. */
  id: string;
  /** Id of the Workspace this session was saved from. */
  workspaceId: string;
  /** Id of the Analysis that was active when the session was saved, if any. */
  activeAnalysisId?: string;
  /** The selection state active at the time of saving. */
  selection?: Selection;
  /** Version/checksum information needed to judge reproducibility on reload. */
  reproducibility: ReproducibilityInfo;
  /** Who saved this session. */
  savedBy: string;
  /** ISO-8601 timestamp the session was saved. */
  savedAt: string;
  /** Human-readable label for this saved session (e.g. `"Before switching to bootstrap CI"`). */
  label?: string;
}
