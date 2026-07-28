# Reproducibility

Every analysis should be recoverable from a session file.

A session stores:
- dataset
- mappings
- filters
- model
- CI settings
- bootstrap seed
- visualization state
- export metadata

The canonical shapes for this are defined in `packages/domain`
(`@er-explorer/domain`): a `Session` points at a `Workspace` and its active
`Analysis`, and carries `ReproducibilityInfo` (app version, dataset
checksum, statistical engine version) so a reload can detect drift instead
of silently reproducing a different result. `Question.ciMethod` and
`Question.bootstrapConfig` (including the seed) capture the CI settings and
bootstrap seed; `Workspace.exportHistory` captures export metadata.

## The `.erx` session file

`packages/session-engine` (`@er-explorer/session-engine`) implements the
actual reproducibility engine on top of those domain shapes: a `.erx` file
is the on-disk realization of "every analysis should be recoverable from a
session file". Everything ER Explorer needs to reopen a scientist's exact
work is plain, JSON-serializable data with no functions, class instances,
or other non-serializable values anywhere in it - the whole point being
that a `.erx` file can be copied, emailed, or checked into version control
like any other document and still reproduce the analysis it came from.

A `SessionFile` embeds:

- `workspace` - the full `Workspace` (dataset schema/provenance, every
  `Analysis` with its `Question`, model configuration (`AnalysisSpec`),
  `Prediction`, and visualization configuration, notes, and export
  history)
- `selections` - every currently-active `Selection`, keyed by panel/scope
  id (a session can have more than one brush/highlight active at once)
- `theme` and `panels` - saved UI appearance and layout preferences
- `history` - an append-only log of changes, for audit and undo/redo
- `reproducibility` - app version, dataset checksum, and statistical
  engine version, for detecting drift on reload

wrapped in an envelope carrying:

- `erx` - a magic string identifying the JSON as an ER Explorer session
  file before anything else about it is trusted
- `formatVersion` - the schema version of the `.erx` format itself (see
  Versioning and migration, below) - distinct from the application's own
  version
- `id` - a UUID v4 uniquely identifying this saved file
- `checksum` - an integrity checksum over the rest of the file's content

### Versioning and migration

`SESSION_FORMAT_VERSION` (`packages/session-engine/src/version.ts`) is the
current `.erx` schema version. It is bumped only when `SessionFile`'s shape
changes in a way an older reader could not parse as-is. Each bump is
expected to come with a migration registered via
`registerSessionMigration(fromVersion, migrate)`
(`packages/session-engine/src/migrations.ts`), so that opening an older
`.erx` file transparently upgrades it in memory, one version at a time,
before it is validated - this is the mechanism that lets old session files
stay loadable indefinitely as the format evolves. Attempting to open a file
whose `formatVersion` is *newer* than the running build supports throws
`UnsupportedSessionVersionError` rather than guessing.

### Checksum

The `checksum` field is computed by `computeChecksum`
(`packages/session-engine/src/checksum.ts`): the file's content (everything
except `checksum` itself) is canonicalized - deep-cloned with every
object's keys sorted, so the result doesn't depend on incidental key
order - then hashed with a dependency-free 64-bit FNV-1a implementation.
This is intentionally a fast, non-cryptographic hash: its job is to detect
*accidental* drift (a hand-edited or corrupted file, or a dataset that
changed since the session was saved), not to resist a deliberate attacker.
`deserializeSessionFile` reports whether the checksum still matches
(`checksumValid`) but does not throw on a mismatch - matching this
document's principle that a reload should warn, not silently reproduce a
different result, leaving the decision of how to warn to the UI layer.

### Serializer / deserializer

`serializeSessionFile` (`serialize.ts`) recomputes the checksum immediately
before writing, so the checksum in a written `.erx` file always matches its
actual content. `deserializeSessionFile` (`deserialize.ts`) parses the
JSON, checks the `erx` marker, migrates if the file predates the current
format version, validates that every required field is present, and
verifies the checksum - returning the parsed `SessionFile` alongside
`migratedFrom` (if migration was needed) and `checksumValid`.

### Everything is serializable

Nothing in `packages/domain` or the `SessionFile` envelope depends on
functions, `Date` objects, `Map`/`Set`, or class instances - timestamps are
ISO-8601 strings, identifiers are UUID v4 strings, and every nested shape
(`Theme`, `PanelLayout`, `History`) is plain data. This is deliberate: it is
what makes "every analysis is reproduced via session files" (ADR-0004)
actually true rather than aspirational - a `.erx` file is just JSON, so it
can be diffed, hashed, and round-tripped through `JSON.stringify`/
`JSON.parse` with nothing lost.
