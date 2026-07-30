import type { DrawTarget, LaidOutMarker, MarkerCandidate } from "./types";

const LABEL_HEIGHT = 30;
const LABEL_GAP = 5;
const CLUSTER_GAP_PX = 80;

/**
 * Lays out curve-adjacent marker labels (an observed-rate readout, a reference-line fit value,
 * a censoring tick, ...) so nearby ones never overlap - ported from the current renderer's
 * `layoutMarkers`. Markers whose pixel-x positions are close together are grouped into a
 * cluster and stacked into a vertical column - the one with the highest natural position
 * anchors the stack, and the rest are placed directly above it. A dependency-free stand-in for
 * a proper force/repel layout, dispatched purely on geometry (x-proximity, natural position from
 * `yHigh`), never on `kind` - the algorithm doesn't need to know what a marker represents.
 *
 * Called exactly once by the Renderer, across every marker every Layer pushed, after every
 * Layer has rendered - not per-Layer, which is what preserves whole-chart collision avoidance
 * without any Layer needing to know about any other Layer's markers.
 */
export function resolveMarkers(candidates: MarkerCandidate[], plotTop: number, plotBottom: number): LaidOutMarker[] {
  if (!candidates.length) return [];

  const sorted = [...candidates].sort((a, b) => a.x - b.x);
  const clusters: MarkerCandidate[][] = [];
  for (const m of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && m.x - last[last.length - 1].x < CLUSTER_GAP_PX) last.push(m);
    else clusters.push([m]);
  }

  const minTop = plotTop + 2;
  const maxBottom = plotBottom - 2;
  const available = maxBottom - minTop;
  const placed: LaidOutMarker[] = [];

  for (const cluster of clusters) {
    const withNatural = cluster
      .map((m) => ({ m, natural: (m.yHigh ?? m.y) - 34 }))
      .sort((a, b) => a.natural - b.natural);
    const n = withNatural.length;
    const requiredSpan = n * LABEL_HEIGHT + (n - 1) * LABEL_GAP;

    if (requiredSpan > available) {
      // More markers are crowded into this x-region than can fit at full size while both
      // staying on-canvas and keeping their natural stacking order - spread them evenly across
      // the whole available vertical range instead of letting some run off an edge.
      const step = n > 1 ? (available - LABEL_HEIGHT) / (n - 1) : 0;
      withNatural.forEach(({ m }, i) => placed.push({ ...m, labelTop: minTop + i * step }));
      continue;
    }

    const tops: number[] = [];
    let nextTop = Infinity;
    withNatural.forEach(({ natural }, i) => {
      const top = i === 0 ? natural : Math.min(natural, nextTop - LABEL_HEIGHT - LABEL_GAP);
      nextTop = top;
      tops.push(top);
    });
    // A tall stack can run out of room above or below the plot - shift the whole stack just
    // enough to clear whichever edge it overflows, keeping every label's relative spacing intact.
    const topOverflow = minTop - Math.min(...tops);
    const bottomOverflow = Math.max(...tops) + LABEL_HEIGHT - maxBottom;
    const shift = topOverflow > 0 ? topOverflow : bottomOverflow > 0 ? -bottomOverflow : 0;
    withNatural.forEach(({ m }, i) => placed.push({ ...m, labelTop: tops[i] + shift }));
  }

  return placed;
}

/**
 * Renders one already-laid-out marker: dot + CI error bar (when `yLow`/`yHigh` are present) +
 * up to two label lines, with a white halo/backdrop so it stays legible over dense scatter
 * points, and a leader line back to its true point whenever the label had to be relocated to
 * avoid a neighbor. Ported from the current renderer's `renderMarker`.
 */
export function renderLaidOutMarker(target: DrawTarget, marker: LaidOutMarker): void {
  const { x, y, color, lines, labelTop } = marker;
  const yLo = marker.yLow ?? y;
  const yHi = marker.yHigh ?? y;
  const line1 = lines[0] ?? "";
  const line2 = lines[1] ?? "";
  const labelBoxWidth = Math.max(line1.length, line2.length) * 7 + 10;
  const labelBottom = labelTop + LABEL_HEIGHT;

  if (labelBottom < yHi - 2) {
    target.drawLine(
      [
        { x, y: yHi },
        { x, y: labelBottom }
      ],
      { stroke: color, strokeWidth: 1, dash: "2 2", opacity: 0.6 }
    );
  }
  target.drawLine(
    [
      { x, y: yLo - 7 },
      { x, y: yHi + 7 }
    ],
    { stroke: "#ffffff", strokeWidth: 8, opacity: 0.9, lineCap: "round" }
  );
  target.drawCircle(x, y, 8, { fill: "#ffffff", opacity: 0.92 });
  target.drawRect(
    { x: x - labelBoxWidth / 2, y: labelTop, width: labelBoxWidth, height: LABEL_HEIGHT },
    { fill: "#ffffff", opacity: 0.94, stroke: color, strokeWidth: 1.2, rx: 5 }
  );

  target.drawLine(
    [
      { x, y: yLo },
      { x, y: yHi }
    ],
    { stroke: color, strokeWidth: 1.8, opacity: 0.95 }
  );
  target.drawLine(
    [
      { x: x - 4.5, y: yLo },
      { x: x + 4.5, y: yLo }
    ],
    { stroke: color, strokeWidth: 1.5, opacity: 0.95 }
  );
  target.drawLine(
    [
      { x: x - 4.5, y: yHi },
      { x: x + 4.5, y: yHi }
    ],
    { stroke: color, strokeWidth: 1.5, opacity: 0.95 }
  );
  target.drawCircle(x, y, 4.6, { fill: color, stroke: "#fff", strokeWidth: 1.4 });
  target.drawText(x, labelTop + 14, line1, { textAnchor: "middle", fill: color, fontSize: 12, fontWeight: 800 });
  target.drawText(x, labelTop + 26, line2, { textAnchor: "middle", fill: color, fontSize: 10.5 });
}
