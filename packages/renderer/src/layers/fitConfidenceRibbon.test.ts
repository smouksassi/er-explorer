import { describe, expect, it } from "vitest";
import type { CurveSample } from "../curveSample";
import { StepStyle } from "../curveStyle";
import { SVGRenderer } from "../svgRenderer";
import { ScatterLayer } from "./scatter";
import { ConfidenceRibbonLayer } from "./confidenceRibbon";
import { FitLayer } from "./fit";

const samples: CurveSample[] = [
  { exposure: 0, estimate: 0.1, lower: 0.05, upper: 0.2 },
  { exposure: 50, estimate: 0.5, lower: 0.4, upper: 0.6 },
  { exposure: 100, estimate: 0.9, lower: 0.8, upper: 0.95 }
];

describe("FitLayer", () => {
  it("draws a stroked, dashed path through the curve samples", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new FitLayer({ id: "curve", samples })]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-fit curve");
    expect(svg).toContain('stroke-dasharray="7 5"');
    expect(svg).not.toContain("<circle"); // no scatter layer present
  });

  it("draws nothing for fewer than two samples", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new FitLayer({ id: "curve", samples: [samples[0]] })]
    });
    expect(result.content as string).not.toContain("<path");
  });

  it("accepts a StepStyle for step-function endpoint types (e.g. Kaplan-Meier)", () => {
    const renderer = new SVGRenderer();
    const smooth = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new FitLayer({ id: "curve", samples })]
    }).content as string;
    const stepped = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new FitLayer({ id: "curve", samples, style: StepStyle })]
    }).content as string;
    expect(stepped).not.toBe(smooth);
  });
});

describe("ConfidenceRibbonLayer", () => {
  it("draws a filled, unstroked band", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new ConfidenceRibbonLayer({ id: "band", samples })]
    });
    const svg = result.content as string;
    expect(svg).toContain("er-confidence-ribbon band");
    expect(svg).toContain('stroke="none"');
  });

  it("skips rendering entirely if any sample has a non-finite lower/upper bound", () => {
    const renderer = new SVGRenderer();
    const withGap: CurveSample[] = [samples[0], { ...samples[1], lower: NaN, upper: NaN }, samples[2]];
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [new ConfidenceRibbonLayer({ id: "band", samples: withGap })]
    });
    expect(result.content as string).not.toContain("er-confidence-ribbon");
  });
});

describe("Fit/ConfidenceRibbon paint order relative to Scatter", () => {
  it("paints the band under the curve, and the curve under scatter points, regardless of construction order", () => {
    const renderer = new SVGRenderer();
    const result = renderer.render({
      width: 600,
      height: 300,
      xDomain: [0, 100],
      yDomain: [0, 1],
      layers: [
        new ScatterLayer({ id: "points", points: [{ id: 1, x: 10, y: 0.3 }] }),
        new FitLayer({ id: "curve", samples }),
        new ConfidenceRibbonLayer({ id: "band", samples })
      ]
    });
    const svg = result.content as string;
    const bandIndex = svg.indexOf("er-confidence-ribbon");
    const fitIndex = svg.indexOf("er-fit");
    const scatterIndex = svg.indexOf("er-points");
    expect(bandIndex).toBeGreaterThanOrEqual(0);
    expect(fitIndex).toBeGreaterThan(bandIndex);
    expect(scatterIndex).toBeGreaterThan(fitIndex);
  });
});
