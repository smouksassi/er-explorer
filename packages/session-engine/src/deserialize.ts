import { checksumMatches } from "./checksum";
import { migrateSessionData } from "./migrations";
import { SESSION_FILE_KIND, type SessionFile, withoutChecksum } from "./sessionFile";
import { SESSION_FORMAT_VERSION, type SessionFormatVersion } from "./version";

/** Thrown when a string cannot be read as a `.erx` session file at all - invalid JSON, not an object, missing the `erx` marker, or missing a required field. Distinct from {@link UnsupportedSessionVersionError}, which is specifically about format-version mismatches. */
export class SessionFileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionFileParseError";
  }
}

/** Fields every {@link SessionFile}, of any format version, must have once fully migrated - used to validate a parsed file before handing it back to the caller as a `SessionFile`. */
const REQUIRED_SESSION_FILE_KEYS: Array<keyof SessionFile> = [
  "erx",
  "formatVersion",
  "id",
  "checksum",
  "savedAt",
  "savedBy",
  "reproducibility",
  "workspace",
  "selections",
  "theme",
  "panels",
  "history"
];

export interface DeserializeSessionResult {
  /** The parsed (and, if necessary, migrated) session. */
  session: SessionFile;
  /** The format version the file was actually saved at, if migration was needed to reach the current version. Absent if no migration was needed. */
  migratedFrom?: SessionFormatVersion;
  /** Whether the file's checksum matches its content. `false` signals the `.erx` file was edited by hand, corrupted, or produced by a non-conforming writer - the caller (not this function) decides whether that should block loading or just surface a warning, matching `docs/REPRODUCIBILITY.md`'s "warn rather than silently produce a different result". */
  checksumValid: boolean;
}

/**
 * Parse `.erx` text back into a {@link SessionFile}.
 *
 * Runs, in order: JSON parsing, the `erx` magic-string check, version
 * migration (see `migrations.ts`) if the file predates
 * {@link SESSION_FORMAT_VERSION}, required-field validation, and checksum
 * verification. Throws {@link SessionFileParseError} for anything that
 * isn't recognizably a session file, or `UnsupportedSessionVersionError`
 * (from `migrations.ts`) if the file's version can't be reached from here.
 * A checksum mismatch does *not* throw - see {@link DeserializeSessionResult.checksumValid}.
 */
export function deserializeSessionFile(raw: string): DeserializeSessionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SessionFileParseError(`Session file is not valid JSON: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SessionFileParseError("Session file must contain a JSON object");
  }

  let record = parsed as Record<string, unknown>;

  if (record.erx !== SESSION_FILE_KIND) {
    throw new SessionFileParseError(`Not an ER Explorer session file (expected "erx": "${SESSION_FILE_KIND}")`);
  }

  const originalVersion: SessionFormatVersion = typeof record.formatVersion === "number" ? record.formatVersion : 0;
  if (originalVersion !== SESSION_FORMAT_VERSION) {
    record = migrateSessionData(record);
  }

  for (const key of REQUIRED_SESSION_FILE_KEYS) {
    if (!(key in record)) {
      throw new SessionFileParseError(`Session file is missing required field "${key}"`);
    }
  }

  const session = record as unknown as SessionFile;
  const checksumValid = typeof session.checksum === "string" && checksumMatches(withoutChecksum(session), session.checksum);

  return {
    session,
    migratedFrom: originalVersion === SESSION_FORMAT_VERSION ? undefined : originalVersion,
    checksumValid
  };
}
