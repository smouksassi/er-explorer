import type { Selection } from "@er-explorer/domain";
import { computeChecksum } from "./checksum";
import type { HistoryActionKind, HistoryEntry } from "./history";
import { type SessionFile, withoutChecksum } from "./sessionFile";
import { createUuidV4 } from "./uuid";

/** Recompute and attach a fresh checksum after a SessionFile's content has changed. Internal helper shared by every mutation in this module. */
function withRecomputedChecksum(session: SessionFile): SessionFile {
  return { ...session, checksum: computeChecksum(withoutChecksum(session)) };
}

/** Input to {@link appendHistoryEntry}; `id` and `timestamp` are filled in automatically when omitted. */
export type HistoryEntryInput = Omit<HistoryEntry, "id" | "timestamp"> & Partial<Pick<HistoryEntry, "id" | "timestamp">>;

/**
 * Immutably append one entry to a session's history log and return a new
 * {@link SessionFile} with an up-to-date checksum.
 *
 * Never mutates `session` - every operation in this module returns a new
 * object, consistent with a `SessionFile` being a value that gets
 * serialized wholesale, not a stateful object with hidden internal
 * mutation.
 */
export function appendHistoryEntry(session: SessionFile, entry: HistoryEntryInput): SessionFile {
  const fullEntry: HistoryEntry = {
    id: entry.id ?? createUuidV4(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
    actionKind: entry.actionKind,
    description: entry.description,
    analysisId: entry.analysisId,
    before: entry.before,
    after: entry.after
  };
  return withRecomputedChecksum({ ...session, history: [...session.history, fullEntry] });
}

/**
 * Immutably set (or clear) the active {@link Selection} for a given scope
 * (typically a panel id), recording a matching `"update-selection"`
 * history entry, and return a new SessionFile with an up-to-date checksum.
 */
export function setSelection(session: SessionFile, scopeId: string, selection: Selection | undefined, description = `Updated selection for "${scopeId}"`): SessionFile {
  const before = session.selections[scopeId];
  const selections = { ...session.selections };
  if (selection) {
    selections[scopeId] = selection;
  } else {
    delete selections[scopeId];
  }

  const updated: SessionFile = { ...session, selections };
  const actionKind: HistoryActionKind = "update-selection";
  return appendHistoryEntry(updated, {
    actionKind,
    description,
    before,
    after: selection
  });
}

/** Immutably set which Analysis is active/focused, recording a history entry, and return a new SessionFile with an up-to-date checksum. */
export function setActiveAnalysis(session: SessionFile, analysisId: string | undefined, description = "Changed active analysis"): SessionFile {
  const before = session.activeAnalysisId;
  const updated: SessionFile = { ...session, activeAnalysisId: analysisId };
  return appendHistoryEntry(updated, {
    actionKind: "custom",
    description,
    before,
    after: analysisId
  });
}
