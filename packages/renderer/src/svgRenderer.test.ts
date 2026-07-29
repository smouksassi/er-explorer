import { describe, expect, it } from "vitest";
import { AxisLayer } from "./layers/axis";
import { GridLayer } from "./layers/grid";
import { ScatterLayer } from "./layers/scatter";
import { SVGRenderer } from "./svgRenderer";

const points = [
  { id: 1, x: 10, y: 0.2 },
  { id: 2, x: 50, y: 0.8 },
  { id: 3, x: 90, y: 0.5 }
];

describe("SVGRenderer (Phase 1: core primitives + Axis/Grid/Scatter)", () => {
  it("renders a self-contained SVG string with one circle per scatter point", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new GridLayer({ id: "grid" }),
        new AxisLayer({ id: "axis-x", orientation: "x", label: "Exposure" }),
        new AxisLayer({ id: "axis-y", orientation: "y", label: "Response" }),
        new ScatterLayer({ id: "points", points })
      ]
    });

    expect(result.outputType).toBe("svg");
    const svg = result.content as string;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect((svg.match(/<circle/g) ?? []).length).toBe(points.length);
    expect(svg).toContain("Exposure");
    expect(svg).toContain("Response");
  });

  it("paints layers in fixed rank order regardless of construction order (grid, then axis, then scatter)", () => {
    const renderer = new SVGRenderer();
    // Deliberately pushed in reverse rank order - the Renderer must still paint grid first, then
    // axis, then scatter, because paint order is rank-owned, not caller-owned (design doc §6).
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new ScatterLayer({ id: "points", points }),
        new AxisLayer({ id: "axis-x", orientation: "x" }),
        new GridLayer({ id: "grid" })
      ]
    });
    const svg = result.content as string;
    const gridIndex = svg.indexOf("er-grid");
    const axisIndex = svg.indexOf("er-axis-x");
    const scatterIndex = svg.indexOf("er-points");
    expect(gridIndex).toBeGreaterThanOrEqual(0);
    expect(axisIndex).toBeGreaterThan(gridIndex);
    expect(scatterIndex).toBeGreaterThan(axisIndex);
  });

  it("lets a per-layer zIndex override the default rank as an escape hatch", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new GridLayer({ id: "grid" }),
        // Forced to paint after scatter (rank 40) despite being an "axis" (default rank 5).
        Object.assign(new AxisLayer({ id: "axis-x", orientation: "x" }), { zIndex: 999 }),
        new ScatterLayer({ id: "points", points })
      ]
    });
    const svg = result.content as string;
    expect(svg.indexOf("er-points")).toBeLessThan(svg.indexOf("er-axis-x"));
  });

  it("computes plotRect/xScale/yScale metadata consistent with the default margin", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 1200,
      height: 420,
      xDomain: [0, 300],
      yDomain: [-0.18, 1.18],
      layers: []
    });
    expect(result.metadata.plotRect).toEqual({ x: 96, y: 22, width: 1200 - 96 - 20, height: 420 - 22 - 56 });
    expect(result.metadata.xScale(0)).toBeCloseTo(96);
    expect(result.metadata.xScale(300)).toBeCloseTo(96 + (1200 - 96 - 20));
  });

  it("respects a caller-supplied partial margin override", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 800,
      height: 400,
      margin: { left: 40 },
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: []
    });
    expect(result.metadata.plotRect.x).toBe(40);
    // untouched margin fields keep their defaults
    expect(result.metadata.plotRect.y).toBe(22);
  });

  it("collects hit-regions added by a layer into RenderResult.metadata, uncollided", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new ScatterLayer({ id: "points", points, registerHitRegions: true })]
    });
    expect(result.metadata.hitRegions).toHaveLength(points.length);
    expect(result.metadata.markers).toHaveLength(0);
  });

  it("does not register hit-regions when a layer opts out (the default)", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new ScatterLayer({ id: "points", points })]
    });
    expect(result.metadata.hitRegions).toHaveLength(0);
  });
});
