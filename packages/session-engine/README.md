# @er-explorer/session-engine

The reproducibility engine for ER Explorer: the versioned, checksummed
`.erx` session file format.

Implements ADR-0004 ("every analysis is reproduced via session files") and
`docs/REPRODUCIBILITY.md`. Contains no statistical computation and no
rendering/UI code (no React, no D3) - only the engine that turns a
`@er-explorer/domain` `Workspace` (plus session-only UI state) into a
portable, self-verifying `.erx` file, and back.

## Contents

- `sessionFile.ts` - `SessionFile`, the full `.erx` document shape, and
  `createSessionFile` to build one from a `Workspace`.
- `serialize.ts` / `deserialize.ts` - the Serializer and Deserializer.
- `version.ts` / `migrations.ts` - the Version and Migration machinery that
  keeps old `.erx` files loadable across future format changes.
- `checksum.ts` - a dependency-free, deterministic integrity checksum
  (canonical JSON + 64-bit FNV-1a).
- `uuid.ts` - dependency-free UUID v4 generation.
- `theme.ts` / `panels.ts` / `history.ts` / `selections.ts` - the
  session-only concerns (`Theme`, `PanelLayout`, `History`,
  `SessionSelections`) that sit alongside the embedded `Workspace`.
- `operations.ts` - small, pure, immutable helpers (`appendHistoryEntry`,
  `setSelection`, `setActiveAnalysis`) that update a `SessionFile` and keep
  its checksum in sync.
- `legacySession.ts` - the original, pre-domain-model session shape
  (`SessionState`), preserved unchanged because `apps/demo` still depends
  on it. New code should use `SessionFile` instead.

## Scripts

```
pnpm build      # tsc -> dist/ (declarations + JS, test files excluded)
pnpm typecheck  # tsc --noEmit, including test files
pnpm test       # typecheck, then vitest run
```
