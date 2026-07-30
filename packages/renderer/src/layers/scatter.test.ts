import { describe, expect, it } from "vitest";
import { SVGRenderer } from "../svgRenderer";
import { ScatterLayer } from "./scatter";

describe("ScatterLayer", () => {
  it("merges a point's `data` bag onto its <circle> as extra attributes", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new ScatterLayer({
          id: "points",
          points: [{ id: 1, x: 50, y: 0.5, data: { "data-id": 1, "data-exposure": 50, "data-group": "2400 mg" } }]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).toContain('data-id="1"');
    expect(svg).toContain('data-exposure="50"');
    expect(svg).toContain('data-group="2400 mg"');
  });

  it("draws no extra attributes when a point has no `data`", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new ScatterLayer({ id: "points", points: [{ id: 1, x: 50, y: 0.5 }] })]
    });
    expect(result.content as string).not.toContain("data-");
  });
});
