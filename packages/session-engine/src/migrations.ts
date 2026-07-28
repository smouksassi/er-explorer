import { MINIMUM_SUPPORTED_SESSION_FORMAT_VERSION, SESSION_FORMAT_VERSION, type SessionFormatVersion } from "./version";

/**
 * A single migration step: given the raw (parsed-JSON, not yet validated)
 * data of a session file at format version `N`, return data reshaped for
 * format version `N + 1`.
 *
 * Deliberately typed over `Record<string, unknown>` rather than
 * `SessionFile` - a migration's whole job is to take data that does *not*
 * yet match the current `SessionFile` shape and make it match one step of
 * the way there, so it cannot assume the current interface.
 */
export type SessionMigration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Thrown by {@link migrateSessionData} when a session file's format version
 * cannot be reached from its stored version - either because it is newer
 * than this build understands, or because a migration step is missing.
 */
export class UnsupportedSessionVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSessionVersionError";
  }
}

/**
 * Registered migrations, keyed by the format version being migrated *from*.
 * Empty today because format version 1 is the only version that has ever
 * existed - this registry, plus {@link migrateSessionData}, is the
 * extension point future sprints use to keep old `.erx` files loadable:
 * bump {@link SESSION_FORMAT_VERSION} in `version.ts`, then register a
 * migration here keyed by the version being replaced.
 */
const migrations = new Map<SessionFormatVersion, SessionMigration>();

/** Register a migration from `fromVersion` to `fromVersion + 1`. Intended to be called once per version bump, typically at module load time. */
export function registerSessionMigration(fromVersion: SessionFormatVersion, migration: SessionMigration): void {
  migrations.set(fromVersion, migration);
}

/** Remove every registered migration. Exposed only for test isolation. */
export function clearSessionMigrations(): void {
  migrations.clear();
}

/**
 * Bring `data` up to {@link SESSION_FORMAT_VERSION} by applying registered
 * migrations one version at a time, starting from `data.formatVersion`
 * (treated as version 0 - i.e. pre-versioning - if the field is absent or
 * not a number).
 *
 * Throws {@link UnsupportedSessionVersionError} if `data` claims a format
 * version newer than this build supports, or if a required migration step
 * was never registered (a gap in the chain).
 */
export function migrateSessionData(data: Record<string, unknown>): Record<string, unknown> {
  let current = data;
  let version: SessionFormatVersion = typeof current.formatVersion === "number" ? current.formatVersion : 0;

  if (version > SESSION_FORMAT_VERSION) {
    throw new UnsupportedSessionVersionError(
      `Session file format version ${version} is newer than the version ${SESSION_FORMAT_VERSION} this build of ER Explorer supports.`
    );
  }
  if (version < MINIMUM_SUPPORTED_SESSION_FORMAT_VERSION && version === 0 && !migrations.has(0)) {
    throw new UnsupportedSessionVersionError(
      `Session file has no format version and no migration from an unversioned file is registered; it predates the minimum supported version ${MINIMUM_SUPPORTED_SESSION_FORMAT_VERSION}.`
    );
  }

  while (version < SESSION_FORMAT_VERSION) {
    const migration = migrations.get(version);
    if (!migration) {
      throw new UnsupportedSessionVersionError(
        `No migration registered from session format version ${version} to ${version + 1}.`
      );
    }
    current = migration(current);
    const nextVersion = typeof current.formatVersion === "number" ? current.formatVersion : version + 1;
    if (nextVersion <= version) {
      throw new UnsupportedSessionVersionError(
        `Migration from session format version ${version} did not advance the format version.`
      );
    }
    version = nextVersion;
  }

  return current;
}
