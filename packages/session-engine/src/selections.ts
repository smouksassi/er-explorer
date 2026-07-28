import type { Selection } from "@er-explorer/domain";

/**
 * Every currently-active {@link Selection} in a session, keyed by an
 * arbitrary scope id (typically a panel id from {@link PanelLayout}, or an
 * Analysis id).
 *
 * A single `Selection` (from `@er-explorer/domain`) describes one
 * highlighted set of records; a session can have more than one active at
 * once - e.g. a brush on an AUC panel and an independent brush on a Cmax
 * panel - which is why the `.erx` format stores a map here rather than one
 * global `Selection`.
 */
export type SessionSelections = Record<string, Selection>;
