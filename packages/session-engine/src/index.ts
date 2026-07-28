/**
 * `@er-explorer/session-engine` - the reproducibility engine for ER
 * Explorer.
 *
 * Implements ADR-0004 ("every analysis is reproduced via session files")
 * and `docs/REPRODUCIBILITY.md`: everything in ER Explorer must be
 * serializable, and a saved `.erx` session file must be enough, on its
 * own, to reopen the exact analysis it was saved from.
 *
 * The core artifact is {@link SessionFile} (see `sessionFile.ts`) - a
 * versioned, checksummed, UUID-identified document embedding a full
 * `@er-explorer/domain` `Workspace` plus session-only concerns (active
 * `Selection`s, `Theme`, `PanelLayout`, `History`). Around it:
 *
 * - `serialize.ts` / `deserialize.ts` - the Serializer and Deserializer,
 *   turning a SessionFile to and from `.erx` (JSON) text.
 * - `version.ts` / `migrations.ts` - the Version and Migration machinery
 *   that lets old `.erx` files stay loadable across future format changes.
 * - `checksum.ts` - deterministic, dependency-free integrity checksums.
 * - `uuid.ts` - dependency-free UUID v4 generation.
 * - `operations.ts` - small, pure, immutable helpers for updating a
 *   SessionFile (append history, change selection/active analysis) while
 *   keeping its checksum in sync.
 *
 * This package contains no statistical computation and no rendering/UI
 * code (no React, no D3) - only the reproducibility engine itself.
 *
 * `legacySession.ts` preserves the original, pre-domain-model session
 * shape (`SessionState`) unchanged, since `apps/demo` already depends on
 * it; new code should use `SessionFile` instead.
 */

export {
  type SessionMetadata,
  type SessionState,
  createSessionMetadata,
  createSessionState,
  InvalidSessionFileError,
  serializeSession,
  parseSession
} from "./legacySession";

export { createUuidV4, isUuid } from "./uuid";

export { type ChecksumAlgorithm, CHECKSUM_ALGORITHM, fnv1a64, canonicalize, computeChecksum, checksumMatches } from "./checksum";

export { type SessionFormatVersion, SESSION_FORMAT_VERSION, MINIMUM_SUPPORTED_SESSION_FORMAT_VERSION } from "./version";

export {
  type SessionMigration,
  UnsupportedSessionVersionError,
  registerSessionMigration,
  clearSessionMigrations,
  migrateSessionData
} from "./migrations";

export { type ThemeMode, type Theme, DEFAULT_THEME } from "./theme";

export { type PanelState, type PanelLayout, DEFAULT_PANEL_LAYOUT } from "./panels";

export { type HistoryActionKind, type HistoryEntry } from "./history";

export { type SessionSelections } from "./selections";

export {
  SESSION_FILE_KIND,
  SESSION_FILE_EXTENSION,
  type SessionFile,
  type CreateSessionFileInput,
  type ChecksummedSessionFile,
  withoutChecksum,
  createSessionFile
} from "./sessionFile";

export { serializeSessionFile } from "./serialize";

export { type DeserializeSessionResult, SessionFileParseError, deserializeSessionFile } from "./deserialize";

export { type HistoryEntryInput, appendHistoryEntry, setSelection, setActiveAnalysis } from "./operations";
