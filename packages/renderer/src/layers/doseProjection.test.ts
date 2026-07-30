import { describe, expect, it } from "vitest";
import type { CurveSample } from "../curveSample";
import { SVGRenderer } from "../svgRenderer";
import { DoseProjectionLayer } from "./doseProjection";

const curveSamples: CurveSample[] = [
  { exposure: 0, estimate: 0, lower: -0.1, upper: 0.1 },
  { exposure: 50, estimate: 0.5, lower: 0.4, upper: 0.6 },
  { exposure: 100, estimate: 1, lower: 0.9, upper: 1.1 }
];

describe("DoseProjectionLayer", () => {
  it("draws a shaded Q1-Q3 band, guide lines, and Q1/median/Q3 dots per group", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DoseProjectionLayer({
          id: "proj",
          curveSamples,
          groups: [{ color: "#ff00ff", q1: 20, q3: 80, median: 50 }]
        })
      ]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-dose-projection proj");
    expect(svg).toContain("<rect"); // Q1-Q3 shaded band
    // 3 dots (Q1, Q3, median) - no min/max supplied
    expect((svg.match(/<circle/g) ?? []).length).toBe(3);
  });

  it("adds hollow min/max markers only when supplied", () => {
    const renderer = new SVGRenderer();
    const withMinMax = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new DoseProjectionLayer({
          id: "proj",
          curveSamples,
          groups: [{ color: "#ff00ff", q1: 20, q3: 80, median: 50, min: 5, max: 95 }]
        })
      ]
    }).content as string;
    expect((withMinMax.match(/<circle/g) ?? []).length).toBe(5); // Q1, Q3, median, min, max
  });

  it("reads the median dot's y-position from the curve's own interpolated estimate", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new DoseProjectionLayer({ id: "proj", curveSamples, groups: [{ color: "#000", q1: 50, q3: 50, median: 50 }] })]
    });
    // At exposure 50, the curve's estimate is exactly 0.5 -> yScale(0.5) is the plot's vertical
    // midpoint. Sanity check the median dot lands there, not at some unrelated default.
    const svg = result.content as string;
    const midY = result.metadata.yScale(0.5);
    expect(svg).toContain(`cy="${midY}"`);
  });

  it("draws nothing for an empty group list", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new DoseProjectionLayer({ id: "proj", curveSamples, groups: [] })]
    });
    expect(result.content as string).not.toContain("er-dose-projection");
  });
});
