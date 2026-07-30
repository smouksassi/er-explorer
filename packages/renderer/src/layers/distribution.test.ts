import { describe, expect, it } from "vitest";
import { SVGRenderer } from "../svgRenderer";
import { DistributionLayer, type DistributionLayerData } from "./distribution";

const summary = { q1: 20, q3: 80, median: 50, whiskerLow: 5, whiskerHigh: 95, min: 0, max: 100 };
const xSamples = [0, 25, 50, 75, 100];
const boxHalfHeights = [0, 12, 12, 12, 0];
const densityHalfHeights = [1, 8, 12, 8, 1];

describe("DistributionLayer", () => {
  it("draws a boxplot row: ridge shape + median line + IQR lines + whisker caps at full opacity", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "boxplot",
          groups: [{ groupId: "1200 mg", label: "1200 mg", color: "#4C72B0", n: 40, xSamples, boxHalfHeights, densityHalfHeights, summary }]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-ridge-shape");
    expect(svg).toContain('data-group="1200 mg"');
    expect(svg).toContain("er-iqr-lines");
    expect(svg).toContain('class="er-caps" opacity="1"');
  });

  it("draws a violin row using density half-heights, with whisker caps hidden (opacity 0)", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "violin",
          groups: [{ groupId: "1200 mg", label: "1200 mg", color: "#4C72B0", n: 40, xSamples, boxHalfHeights, densityHalfHeights, summary }]
        })
      ]
    });
    // Caps are still drawn in the DOM (so a morph animation can cross-fade their opacity) - just
    // hidden (opacity 0) in violin mode, matching the old renderer's mode-gated `capOpacity`.
    const svg = result.content as string;
    expect(svg).toContain('class="er-caps" opacity="0"');
    expect(svg).toMatch(/class="er-caps"[^>]*>[\s\S]*?<path/);
  });

  it("draws a lineranges row as a min-max bar with Q1/Q3 ticks and a median dot, no ridge shape", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "lineranges",
          groups: [{ groupId: "1200 mg", label: "1200 mg", color: "#4C72B0", n: 40, xSamples, boxHalfHeights, densityHalfHeights, summary }]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).not.toContain("er-ridge-shape");
    expect(svg).toContain("<circle"); // median dot
  });

  it("skips the shape (but keeps the row label, count, and click target) for skipShape groups", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "boxplot",
          groups: [{ groupId: "Placebo", label: "Placebo", color: "#94a3b8", n: 20, skipShape: true }]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).toContain('data-group="Placebo"');
    expect(svg).toContain("Placebo");
    expect(svg).toContain("n=20");
    expect(svg).not.toContain("er-ridge-shape");
  });

  it("prints an nResponders-aware count label when supplied, otherwise a plain n= count", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "boxplot",
          groups: [
            { groupId: "a", label: "a", color: "#000", n: 40, nResponders: 12, skipShape: true },
            { groupId: "b", label: "b", color: "#000", n: 30, skipShape: true }
          ]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).toContain("n=40 (12 resp.)");
    expect(svg).toContain("n=30");
  });

  it("draws per-group split annotations as plain text above the shape", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "boxplot",
          groups: [
            {
              groupId: "1200 mg",
              label: "1200 mg",
              color: "#4C72B0",
              n: 40,
              xSamples,
              boxHalfHeights,
              densityHalfHeights,
              summary,
              splitAnnotations: [{ x: 50, label: "40 (100%)" }]
            }
          ]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-split-annotations");
    expect(svg).toContain("40 (100%)");
  });

  it("hands back per-group pixel geometry via ctx.layerData, keyed by this layer's own id", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DistributionLayer({
          id: "dist",
          mode: "boxplot",
          groups: [
            { groupId: "a", label: "a", color: "#111", n: 40, xSamples, boxHalfHeights, densityHalfHeights, summary },
            { groupId: "b", label: "b", color: "#222", n: 10, skipShape: true }
          ]
        })
      ]
    });
    const data = result.metadata.layerData["dist"] as DistributionLayerData;
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0].groupId).toBe("a");
    expect(data.groups[0].xSamples).toEqual(xSamples);
    expect(data.groups[0].boxHalfHeights).toEqual(boxHalfHeights);
    expect(data.groups[1].groupId).toBe("b");
    expect(data.groups[1].xSamples).toEqual([]);
    expect(typeof data.boxHalfHeightPx).toBe("number");
    expect(typeof data.band).toBe("number");
  });

  it("draws nothing for an empty group list", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new DistributionLayer({ id: "dist", mode: "boxplot", groups: [] })]
    });
    expect(result.content as string).not.toContain("er-distribution");
  });
});
