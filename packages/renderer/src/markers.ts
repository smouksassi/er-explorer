import type { DrawTarget, LaidOutMarker, MarkerCandidate } from "./types";

const LABEL_HEIGHT = 30;
const LABEL_GAP = 5;
const CLUSTER_GAP_PX = 80;

/** Preferred label top (px): just above the marker's center point on the curve. */
function labelNaturalTop(m: MarkerCandidate): number {
  return m.y - LABEL_HEIGHT - LABEL_GAP;
}

/**
 * Lays out curve-adjacent marker labels (an observed-rate readout, a reference-line fit value,
 * a censoring tick, ...) so nearby ones never overlap - ported from the current renderer's
 * `layoutMarkers`. Markers whose pixel-x positions are close together are grouped into a
 * cluster and de-collided vertically while staying anchored near each marker's `y` (curve
 * height), not the top of the plot.
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
  const placed: LaidOutMarker[] = [];

  const rangesOverlap = (topA: number, topB: number): boolean =>
    topA < topB + LABEL_HEIGHT + LABEL_GAP && topB < topA + LABEL_HEIGHT + LABEL_GAP;

  for (const cluster of clusters) {
    const byY = [...cluster].sort((a, b) => a.y - b.y);
    const tops: number[] = [];

    for (const m of byY) {
      let top = labelNaturalTop(m);
      for (const existing of tops) {
        if (rangesOverlap(top, existing)) top = existing - LABEL_HEIGHT - LABEL_GAP;
      }
      tops.push(top);
      placed.push({ ...m, labelTop: top });
    }

    const minLabel = Math.min(...tops);
    const maxLabel = Math.max(...tops) + LABEL_HEIGHT;
    const topOverflow = minTop - minLabel;
    const bottomOverflow = maxLabel - maxBottom;
    let shift = topOverflow > 0 ? topOverflow : bottomOverflow > 0 ? -bottomOverflow : 0;
    if (shift !== 0) {
      for (let i = placed.length - byY.length; i < placed.length; i++) {
        placed[i]!.labelTop += shift;
      }
    }

    const clusterStart = placed.length - byY.length;
    const clusterTops = placed.slice(clusterStart).map((m) => m.labelTop);
    const span = Math.max(...clusterTops) + LABEL_HEIGHT - Math.min(...clusterTops);
    if (span > maxBottom - minTop && byY.length > 1) {
      const gap = Math.max(2, (maxBottom - minTop - byY.length * LABEL_HEIGHT) / (byY.length - 1));
      byY.forEach((m, i) => {
        placed[clusterStart + i] = { ...m, labelTop: minTop + i * (LABEL_HEIGHT + gap) };
      });
    }
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

  if (labelBottom < y - 2) {
    target.drawLine(
      [
        { x, y },
        { x, y: labelBottom }
      ],
      { stroke: color, strokeWidth: 1, dash: "2 2", opacity: 0.6 }
    );
  } else if (labelBottom < yHi - 2) {
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
    { fill: "#ffffff", opacity: 0.94, stroke: color, strokeWidth: marker.strokeDash ? 1.6 : 1.2, dash: marker.strokeDash, rx: 5 }
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

  if (marker.tooltip) {
    const hitAttrs = { class: "er-marker-hit", "data-er-marker-tip": marker.tooltip, "pointer-events": "all" };
    target.drawCircle(x, y, 18, { fill: "transparent", stroke: "none", opacity: 0, attrs: hitAttrs });
    target.drawRect(
      { x: x - labelBoxWidth / 2, y: labelTop, width: labelBoxWidth, height: LABEL_HEIGHT },
      { fill: "transparent", opacity: 0, attrs: hitAttrs }
    );
  }
}
