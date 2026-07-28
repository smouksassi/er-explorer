/** Color/appearance preference for the ER Explorer UI. Session-level, not per-panel. */
export type ThemeMode = "light" | "dark" | "system";

/**
 * Saved appearance preferences for a {@link SessionFile}.
 *
 * Purely presentational: nothing here affects a fitted {@link Prediction}
 * or any other scientific result, only how the (not-yet-built) UI renders.
 * Captured in the session anyway so reopening a shared `.erx` file looks
 * the way its author intended, not just reproduces the analysis.
 */
export interface Theme {
  mode: ThemeMode;
  /** Optional accent color override, e.g. a CSS color string. */
  accentColor?: string;
  /** Relative font scale, e.g. 1.0 = default, 1.25 = larger text. */
  fontScale?: number;
}

/** The theme new sessions are created with when none is specified. */
export const DEFAULT_THEME: Theme = { mode: "system" };
