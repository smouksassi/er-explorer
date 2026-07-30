import { describe, expect, it } from "vitest";
import { SVGRenderer } from "../svgRenderer";
import { AnnotationLayer } from "./annotation";
import { ObservedStatLayer } from "./observedStat";

describe("AnnotationLayer", () => {
  it("draws a full-height dashed line and a top label for each reference line", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new AnnotationLayer({ id: "refs", lines: [{ value: 50, label: "Median" }] })]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-reference-lines refs");
    expect(svg).toContain("Median");
    expect(svg).toContain('stroke-dasharray="3 3"');
  });

  it("hides a reference line whose value falls outside the x domain", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new AnnotationLayer({ id: "refs", lines: [{ value: 500, label: "Out of range" }] })]
    });
    expect(result.content as string).not.toContain("Out of range");
  });

  it("prints an optional bottom value label independent of the top label", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new AnnotationLayer({ id: "refs", lines: [{ value: 50, label: "T1 (33%)", valueLabel: "50.0" }] })]
    });
    const svg = result.content as string;
    expect(svg).toContain("T1 (33%)");
    expect(svg).toContain("50.0");
  });

  it("does not push a marker unless markerValues is explicitly supplied", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new AnnotationLayer({ id: "refs", lines: [{ value: 50, label: "Median" }] })]
    });
    expect(result.metadata.markers).toHaveLength(0);
  });

  it("pushes a stacked marker for markerValue, using default Fit-style label lines", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new AnnotationLayer({
          id: "refs",
          lines: [{ value: 50, label: "Median", markerValues: [{ estimate: 0.74, lower: 0.65, upper: 0.82 }] }]
        })
      ]
    });
    expect(result.metadata.markers).toHaveLength(1);
    expect(result.metadata.markers[0].lines).toEqual(["Fit 0.74", "[0.65-0.82]"]);
  });

  it("pushes one marker per entry in markerValues, each in its own color (Compare Endpoints)", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new AnnotationLayer({
          id: "refs",
          lines: [
            {
              value: 50,
              label: "Median",
              markerValues: [
                { estimate: 0.3, lower: 0.2, upper: 0.4, color: "#4C72B0" },
                { estimate: 0.7, lower: 0.6, upper: 0.8, color: "#DDAA33" }
              ]
            }
          ]
        })
      ]
    });
    expect(result.metadata.markers).toHaveLength(2);
    expect(new Set(result.metadata.markers.map((m) => m.color))).toEqual(new Set(["#4C72B0", "#DDAA33"]));
  });
});

describe("cross-layer marker collision (ObservedStat + Annotation's markerValue)", () => {
  it("de-collides markers from two different Layer kinds sharing the same x-region", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new ObservedStatLayer({
          id: "obs",
          bins: [{ x: 50, center: 0.7, lower: 0.6, upper: 0.8, n: 20 }]
        }),
        new AnnotationLayer({
          id: "refs",
          // Same x as the observed bin, and a similar y-value/CI, so both markers naturally
          // want to occupy the same vertical space - this is only resolvable if both Layers'
          // markers are collected into one shared pool and laid out together.
          lines: [{ value: 50, label: "Median", markerValues: [{ estimate: 0.72, lower: 0.62, upper: 0.82 }] }]
        })
      ]
    });

    expect(result.metadata.markers).toHaveLength(2);
    const [a, b] = result.metadata.markers;
    // Different owning layers, but resolved together.
    expect(new Set([a.ownerLayerId, b.ownerLayerId])).toEqual(new Set(["obs", "refs"]));
    // Their label boxes must not overlap vertically (LABEL_HEIGHT=30 + LABEL_GAP=5 apart).
    expect(Math.abs(a.labelTop - b.labelTop)).toBeGreaterThanOrEqual(35 - 0.01);
  });
});
