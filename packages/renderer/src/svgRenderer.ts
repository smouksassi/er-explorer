import { resolveMarkers, renderLaidOutMarker } from "./markers";
import { scaleLinear } from "./scale";
import { SvgDrawTarget } from "./svgDrawTarget";
import type { DrawContext, HitRegion, LayerKind, MarkerCandidate, Renderer, RenderInput, RenderResult } from "./types";

/** Matches `renderLogisticScatterChart`/`renderLinearScatterChart`'s shared `DEFAULT_MARGIN`. */
const DEFAULT_MARGIN = { top: 22, right: 20, bottom: 56, left: 96 };

/**
 * Fixed per-kind paint-order rank table (docs/RENDERER_ARCHITECTURE.md §6) - the Renderer, not
 * the caller, owns paint order. Layers are sorted by `(rank, then array position as a
 * tiebreak)`, regardless of the order they were constructed or pushed into
 * `RenderInput.layers`. A per-layer `zIndex` overrides the table for the rare case a caller
 * genuinely needs to deviate.
 */
const LAYER_RANK: Record<LayerKind, number> = {
  grid: 0,
  axis: 5,
  "confidence-ribbon": 10,
  fit: 20,
  distribution: 25,
  annotation: 30,
  scatter: 40,
  "observed-stat": 50
};

export class SVGRenderer implements Renderer {
  render(input: RenderInput): RenderResult {
    const margin = { ...DEFAULT_MARGIN, ...input.margin };
    const plotRect = {
      x: margin.left,
      y: margin.top,
      width: input.width - margin.left - margin.right,
      height: input.height - margin.top - margin.bottom
    };
    const xScale = scaleLinear(input.xDomain, [plotRect.x, plotRect.x + plotRect.width]);
    const yScale = scaleLinear(input.yDomain, [plotRect.y + plotRect.height, plotRect.y]);

    const target = new SvgDrawTarget();
    const markers: MarkerCandidate[] = [];
    const hitRegions: HitRegion[] = [];

    const ctx: DrawContext = {
      width: input.width,
      height: input.height,
      margin,
      plotRect,
      xScale,
      yScale,
      markers: { add: (m) => markers.push(m) },
      interactions: { add: (h) => hitRegions.push(h) },
      target
    };

    const ordered = input.layers
      .map((layer, index) => ({ layer, index }))
      .sort((a, b) => {
        const rankA = a.layer.zIndex ?? LAYER_RANK[a.layer.kind];
        const rankB = b.layer.zIndex ?? LAYER_RANK[b.layer.kind];
        return rankA !== rankB ? rankA - rankB : a.index - b.index;
      });

    for (const { layer } of ordered) layer.render(ctx);

    // Markers are resolved and painted exactly once, after every Layer has rendered - a system
    // pass that sits above the rank table entirely (docs/RENDERER_ARCHITECTURE.md §5/§6), not
    // one more rank within it. This is what lets an ObservedStat marker and an Annotation
    // reference-line's own fit-value marker (or any other Layer's marker) get de-collided
    // jointly, without either Layer knowing the other exists.
    const laidOutMarkers = resolveMarkers(markers, plotRect.y, plotRect.y + plotRect.height);
    if (laidOutMarkers.length) {
      target.group({ class: "er-observed-markers" }, () => {
        for (const marker of laidOutMarkers) renderLaidOutMarker(target, marker);
      });
    }

    const content = `<svg viewBox="0 0 ${input.width} ${input.height}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${target.serialize()}</svg>`;

    return {
      outputType: "svg",
      content,
      metadata: { plotRect, xScale, yScale, markers: laidOutMarkers, hitRegions }
    };
  }
}
