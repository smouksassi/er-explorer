import { describe, expect, it } from "vitest";
import { SVGRenderer } from "../svgRenderer";
import { ObservedStatLayer } from "./observedStat";

describe("ObservedStatLayer", () => {
  it("pushes one marker per bin, with pixel-space coordinates and default labels", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new ObservedStatLayer({
          id: "obs",
          bins: [{ x: 50, center: 0.74, lower: 0.65, upper: 0.82, n: 41 }]
        })
      ]
    });
    expect(result.metadata.markers).toHaveLength(1);
    const [marker] = result.metadata.markers;
    expect(marker.lines).toEqual(["0.74", "n=41"]);
    expect(marker.ownerLayerId).toBe("obs");
    expect(marker.x).toBeCloseTo(result.metadata.xScale(50));
  });

  it("uses caller-supplied primary/secondary labels and color when given", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new ObservedStatLayer({
          id: "obs",
          bins: [{ x: 50, center: 0.74, lower: 0.65, upper: 0.82, n: 41, primaryLabel: "74%", secondaryLabel: "30/41", color: "#ff00ff" }]
        })
      ]
    });
    const [marker] = result.metadata.markers;
    expect(marker.lines).toEqual(["74%", "30/41"]);
    expect(marker.color).toBe("#ff00ff");
  });

  it("draws no direct geometry itself - only markers, resolved and painted by the Renderer", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new ObservedStatLayer({ id: "obs", bins: [{ x: 50, center: 0.5, lower: 0.4, upper: 0.6, n: 10 }] })]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-observed-markers");
    expect(svg).not.toContain("er-observed-stat"); // no bespoke group of its own
  });
});
