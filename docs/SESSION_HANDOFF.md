# Session handoff (for a fresh Claude session on a new machine)

Purpose: this project has been built almost entirely through Claude Cowork
local sessions, which are tied to the device they run on (per Anthropic's own
Cowork architecture docs, only *remote* sessions follow your account across
machines - local sessions don't). This file exists so a brand-new Claude
session, on any machine, can pick up the full context in one read instead of
re-deriving it. If you're a person reading this: point a new Claude session at
this repo and ask it to read this file plus `docs/DECISIONS.md` and
`docs/RENDERER_ARCHITECTURE.md`.

Last updated: 2026-07-30, after commit `8846301`.

## What this project is

ER Explorer: a pnpm/turborepo monorepo for exploring exposure-response
relationships (dose vs. exposure metrics vs. endpoints like BRLS/PRLS/ICGI2/
ICGI3), with an interactive demo app (`apps/demo`) built on a small
from-scratch charting stack (`packages/renderer`).

Workspace packages: `domain` (shared types), `analysis` (statistical model
plugin architecture + legacy logistic fitter), `model-linear` (linear model
plugin), `data` (dataset loading/query), `renderer` (Renderer/Layer SVG
composition), `session-engine` (`.erx` session file format + legacy
visualization-spec adapter). `packages/visualization-engine` (the old
monolithic renderer) has been fully deleted - do not try to resurrect it.

## Current state

The 7-phase renderer migration (visualization-engine -> renderer) is complete
and committed/pushed. See ADR-0009 in `docs/DECISIONS.md` for the design
summary and `docs/RENDERER_ARCHITECTURE.md` §8 for the phase-by-phase log.

Most recent work on top of that migration (commit `8846301`, "Add None CI
option, fix N/n labeling, surface missing endpoint values"):

- **CI method "None"**: `apps/demo`'s CI dropdown has a `none` option
  alongside `wald`/`bootstrap`. When selected, `curveFor()` in
  `apps/demo/src/main.ts` skips CI computation and returns `NaN` for
  `lower`/`upper`. `packages/renderer/src/layers/annotation.ts`'s marker-push
  code now checks `Number.isFinite(mv.lower) && Number.isFinite(mv.upper)`
  and *omits* `yLow`/`yHigh` entirely (rather than passing computed `NaN`
  values through `yScale`) when there's no CI to show -
  `MarkerCandidate.yLow`/`yHigh` are optional exactly for this case, and
  `resolveMarkers`/`renderLaidOutMarker` in `packages/renderer/src/markers.ts`
  already fall back to `y` gracefully. Covered by a regression test in
  `annotation.test.ts` ("omits yLow/yHigh ... for a markerValue with
  non-finite lower/upper").
- **N/n labeling convention**: capital `N=` means a group's total sample
  size; lowercase `n=` means a sub-group/bin count. Applied to:
  `DistributionLayer`'s row-total label (`distribution.ts`, `N=40 (12
  resp.)`), `computeSplitAnnotations()`'s per-quartile/tertile split counts
  in `main.ts` (`n=83 (35%)`), and the dose-click projection's observed-mean
  marker secondary label (`N=...`).
- **"Observed % responders" checkbox** renamed to **"Observed (%/N)"** in
  `apps/demo/index.html`, since continuous endpoints (BRLS/PRLS) have no
  "responders" concept - the toggle shows an observed mean + N there.
- **Missing-value readout**: `updateReadout()` in `main.ts` compares a dose's
  total N against the count of patients with a *finite* value for the
  currently-selected endpoint, and - when they differ - prints `"k missing
  value(s) removed from N=<total>"` in bold (e.g. `1200 mg`'s BRLS endpoint
  is missing one patient's value: `1 missing value removed from N=238`).
  This replaced an earlier, less readable `n=237 of N=238` phrasing per user
  feedback.

## Deferred work (do not start unless asked)

The user explicitly said they'll handle this themselves later: allowing
"Compare Endpoints" for continuous + mixed endpoint types (currently Compare
Endpoints assumes binary/logistic endpoints). Don't pick this up proactively.

## Practical gotchas for whoever continues this

- **OneDrive git lock files.** The repo folder lives under OneDrive, which
  intermittently locks `.git/index.lock`, `.git/HEAD.lock`, or stray
  `.git/objects/*/tmp_obj_*` files. Git often prints `unable to unlink ...:
  Operation not permitted` warnings during `add`/`commit` but the operation
  usually still succeeds underneath - verify with `git log --oneline` /
  `git status --short`, not the exit code. If a whole directory is
  undeletable from a sandboxed shell (`rm -rf` fails on every file inside
  with the same "Operation not permitted"), ask the user to delete it via
  Windows Explorer instead.
- **No git push credentials in the Cowork sandbox.** Commits can be made
  locally, but `git push` fails with "could not read Username for
  'https://github.com'" - the user has pushed every commit themselves
  throughout this project. Don't assume push access; tell them what's
  committed and ask them to push.
- **Verification workflow** (used for every phase/fix in this project,
  because building directly in the OneDrive-synced working tree is slow and
  lock-prone): rsync the repo into a scratch copy under `/tmp` (excluding
  `node_modules`, `dist`, `.git`, `*.tsbuildinfo`, `.turbo`), run
  `pnpm install --frozen-lockfile`, then `tsc -p packages/<pkg>/tsconfig.build.json`
  per package in dependency order (`domain` -> `analysis` -> `model-linear`
  -> `data` -> `renderer` -> `session-engine`), then
  `node apps/demo/scripts/build-data.mjs`, `tsc -p apps/demo/tsconfig.json --noEmit`,
  and `node apps/demo/scripts/build.mjs`. Run `npx vitest run` inside
  `packages/renderer` for the layer test suite. For end-to-end UI
  verification, load the built `apps/demo/dist/index.html` into `jsdom`
  (`runScripts: "dangerously", resources: "usable", pretendToBeVisual: true`)
  and drive the actual DOM controls (selects, checkboxes, clicking
  `g.er-ridge` elements to select a dose) rather than guessing at behavior.
  Once verified, copy the rebuilt `apps/demo/dist/index.html` and `bundle.js`
  back into the real working tree so the user can preview them before
  committing.
- **The demo's dose-selection interaction** happens by clicking a
  `g.er-ridge` element (with a `data-group` attribute) in the distribution
  strip, not by clicking legend items - a smoke test that clicks the wrong
  element will silently find no effect.

## Where to look for more

- `docs/DECISIONS.md` - ADR log, including ADR-0009 (Renderer/Layer
  architecture).
- `docs/RENDERER_ARCHITECTURE.md` - the full design rationale and an 8-phase
  migration log with what each phase delivered.
- `packages/renderer/src/types.ts` - the `Layer`/`DrawContext`/
  `MarkerCandidate`/`RenderResult` contracts every Layer implements against.
- `apps/demo/src/main.ts` - the demo's own state machine, curve-fitting glue,
  and readout logic; large (2000+ lines) but the only place that bridges
  `packages/analysis`/`packages/model-linear` output into renderer input.
