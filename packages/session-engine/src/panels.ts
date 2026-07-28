/**
 * The saved layout state of a single UI panel (e.g. an exposure-response
 * grid, a distribution panel, a notes panel).
 *
 * `PanelState` is deliberately generic and framework-agnostic: it records
 * *that* a panel of a given `kind` exists, whether it's visible, its
 * relative order/size, and whether it's collapsed - not how it renders.
 * `packages/session-engine` must not depend on React or any renderer, so
 * this is plain layout data for a UI layer to interpret, not a component
 * tree.
 */
export interface PanelState {
  /** Stable identifier for this panel within the session. */
  id: string;
  /** What kind of panel this is (e.g. `"exposure-response"`, `"distribution"`, `"notes"`). A UI layer maps this to an actual component. */
  kind: string;
  /** Whether the panel is currently shown. */
  visible: boolean;
  /** Display order among sibling panels (lower first). */
  order: number;
  /** Relative size (e.g. flex-basis percentage or a weight), when the layout supports resizing. */
  size?: number;
  /** Whether the panel is collapsed to a minimized/header-only state. */
  collapsed?: boolean;
  /** Id of the Analysis this panel is showing, when a panel is scoped to one rather than being session-global (e.g. a notes panel). */
  analysisId?: string;
}

/** The saved arrangement of every panel in a session, plus which one currently has focus. */
export interface PanelLayout {
  panels: PanelState[];
  /** Id of the panel that currently has keyboard/interaction focus, if any. */
  activePanelId?: string;
}

/** The panel layout new sessions are created with when none is specified. */
export const DEFAULT_PANEL_LAYOUT: PanelLayout = { panels: [] };
