/**
 * The schema version of the `.erx` {@link SessionFile} format itself - not
 * to be confused with `ReproducibilityInfo.appVersion` (the ER Explorer
 * application version), which can change independently of the file format.
 *
 * Bumped only when `SessionFile`'s shape changes in a way old readers
 * cannot parse as-is. Each bump should come with a migration registered via
 * `registerSessionMigration` (see `migrations.ts`) so older `.erx` files
 * remain loadable indefinitely - the architecture this module and
 * `migrations.ts` exist to support.
 */
export type SessionFormatVersion = number;

/** The current `.erx` session file format version produced by {@link createSessionFile}. */
export const SESSION_FORMAT_VERSION: SessionFormatVersion = 1;

/** The oldest format version this build of the reproducibility engine still knows how to read (via migration). */
export const MINIMUM_SUPPORTED_SESSION_FORMAT_VERSION: SessionFormatVersion = 1;
