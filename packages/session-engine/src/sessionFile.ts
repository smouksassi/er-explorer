import type { ReproducibilityInfo, Workspace } from "@er-explorer/domain";
import { computeChecksum } from "./checksum";
import { DEFAULT_PANEL_LAYOUT, type PanelLayout } from "./panels";
import { DEFAULT_THEME, type Theme } from "./theme";
import type { HistoryEntry } from "./history";
import type { SessionSelections } from "./selections";
import { SESSION_FORMAT_VERSION, type SessionFormatVersion } from "./version";
import { createUuidV4 } from "./uuid";

/** The magic string identifying a JSON document as an ER Explorer session file, distinct from any other JSON a user might feed the deserializer. */
export const SESSION_FILE_KIND = "er-explorer-session" as const;

/** The native file extension for a serialized ER Explorer session. */
export const SESSION_FILE_EXTENSION = ".erx";

/**
 * The full, versioned, checksummed contents of a `.erx` session file - the
 * complete reproducibility unit of ER Explorer.
 *
 * Everything an analyst needs to exactly reopen their work is embedded
 * directly (the `Workspace`, with its `StudyDataset` schema/provenance and
 * every `Analysis` - each already carrying its `Question`, `AnalysisSpec`
 * model configuration, `Prediction`, and visualization configuration, per
 * `@er-explorer/domain`), plus the session-level concerns domain
 * deliberately leaves out of `Workspace`: active per-panel `Selection`s,
 * `Theme`, `PanelLayout`, and an append-only `History` log.
 *
 * `SessionFile` is plain, JSON-serializable data end to end - no functions,
 * no class instances, no non-serializable values anywhere in its fields -
 * satisfying the principle that everything in ER Explorer must be
 * serializable. See `serialize.ts` / `deserialize.ts` for turning this to
 * and from the actual `.erx` text, and `version.ts` / `migrations.ts` for
 * how the format evolves without breaking old files.
 */
export interface SessionFile {
  /** Always {@link SESSION_FILE_KIND}; lets the deserializer reject arbitrary JSON before touching anything else. */
  erx: typeof SESSION_FILE_KIND;
  /** Schema version of this file (see version.ts). */
  formatVersion: SessionFormatVersion;
  /** Unique identifier for this saved session file (UUID v4). */
  id: string;
  /** Integrity checksum computed over the rest of this file's contents (see checksum.ts). Detects accidental or malicious changes between save and load. */
  checksum: string;
  /** ISO-8601 timestamp this file was saved. */
  savedAt: string;
  /** Who saved this file. */
  savedBy: string;
  /** Human-readable label for this saved session (e.g. `"Before switching to bootstrap CI"`). */
  label?: string;
  /** Version/checksum information needed to judge reproducibility on reload (app version, dataset checksum, statistical engine version). */
  reproducibility: ReproducibilityInfo;
  /** The full project this session was saved from: dataset schema/provenance, every analysis, notes, export history, and metadata. */
  workspace: Workspace;
  /** Id of the Analysis that was active/focused when this file was saved, if any. */
  activeAnalysisId?: string;
  /** Every currently-active Selection, keyed by panel/analysis id. */
  selections: SessionSelections;
  /** Saved appearance preferences. */
  theme: Theme;
  /** Saved panel arrangement. */
  panels: PanelLayout;
  /** Append-only log of changes made in this session, for audit and undo/redo. */
  history: HistoryEntry[];
}

/** Input to {@link createSessionFile}. Only `workspace` and `savedBy` are required; everything else defaults sensibly for a brand-new session. */
export interface CreateSessionFileInput {
  workspace: Workspace;
  savedBy: string;
  label?: string;
  activeAnalysisId?: string;
  selections?: SessionSelections;
  theme?: Theme;
  panels?: PanelLayout;
  history?: HistoryEntry[];
  reproducibility?: Partial<ReproducibilityInfo>;
}

/** Fields of a SessionFile whose checksum is computed over them - i.e. every field except `checksum` itself. */
export type ChecksummedSessionFile = Omit<SessionFile, "checksum">;

/** Strip the `checksum` field so the remainder can be (re)hashed without the hash including itself. */
export function withoutChecksum(session: SessionFile): ChecksummedSessionFile {
  const { checksum: _checksum, ...rest } = session;
  return rest;
}

/**
 * Build a brand-new {@link SessionFile}: assigns a fresh UUID, stamps the
 * current format version and save time, defaults the dataset checksum from
 * the given `workspace.dataset` (see `@er-explorer/domain`'s
 * `DatasetProvenance.checksum`) when the caller doesn't supply one, and
 * computes the file's own integrity checksum over everything else.
 */
export function createSessionFile(input: CreateSessionFileInput): SessionFile {
  const withoutOwnChecksum: ChecksummedSessionFile = {
    erx: SESSION_FILE_KIND,
    formatVersion: SESSION_FORMAT_VERSION,
    id: createUuidV4(),
    savedAt: new Date().toISOString(),
    savedBy: input.savedBy,
    label: input.label,
    reproducibility: {
      appVersion: input.reproducibility?.appVersion ?? "0.0.1",
      datasetChecksum:
        input.reproducibility?.datasetChecksum ?? input.workspace.dataset.provenance.checksum ?? computeChecksum(input.workspace.dataset),
      statisticalEngineVersion: input.reproducibility?.statisticalEngineVersion
    },
    workspace: input.workspace,
    activeAnalysisId: input.activeAnalysisId,
    selections: input.selections ?? {},
    theme: input.theme ?? DEFAULT_THEME,
    panels: input.panels ?? DEFAULT_PANEL_LAYOUT,
    history: input.history ?? []
  };

  return { ...withoutOwnChecksum, checksum: computeChecksum(withoutOwnChecksum) };
}
