/**
 * `@er-explorer/model-loess` — LOESS (local polynomial regression) plugin.
 *
 * The third model family (after logistic and linear), added per ADR-0013's
 * contract: the pipelines (curve groups, projections, readout, callouts)
 * consume family adapters and never branch on family — adding this package
 * required wiring an `EndpointFit` kind and UI options only.
 *
 * Matches R `stats::loess` fitted values exactly under
 * `control = loess.control(surface = "direct")`, gaussian family. Legal on any
 * endpoint type, including smoothers on binary data (observed summaries stay
 * endpoint-TYPE driven — x/N Wilson for binary — per user decision 4a; curves
 * are never clamped to [0, 1], the axis pads instead, per round-2 §I.4).
 */
export {
  LOESS_MIN_N,
  fitLoess,
  predictLoess,
  predictLoessAt,
  tQuantile975,
  type LoessFit,
  type LoessOptions,
  type LoessPrediction
} from "./loess";
