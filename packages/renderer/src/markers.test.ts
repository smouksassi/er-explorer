import { describe, expect, it } from "vitest";
import { renderLaidOutMarker, resolveMarkers } from "./markers";
import { SvgDrawTarget } from "./svgDrawTarget";
import type { MarkerCandidate } from "./types";

function marker(overrides: Partial<MarkerCandidate>): MarkerCandidate {
  return {
    id: "m",
    ownerLayerId: "layer",
    x: 100,
    y: 100,
    yLow: 120,
    yHigh: 80,
    color: "#000",
    lines: ["a", "b"],
    kind: "observed-stat",
    ...overrides
  };
}

describe("resolveMarkers", () => {
  it("returns an empty array for no candidates", () => {
    expect(resolveMarkers([], 0, 300)).toEqual([]);
  });

  it("places a single marker just above its center y", () => {
    const [laidOut] = resolveMarkers([marker({ y: 100, yHigh: 80 })], 0, 300);
    expect(laidOut.labelTop).toBeCloseTo(100 - 30 - 5);
  });

  it("keeps markers in separate x-clusters at their own natural positions", () => {
    const far = [marker({ id: "a", x: 0, y: 50 }), marker({ id: "b", x: 500, y: 200 })];
    const laidOut = resolveMarkers(far, 0, 300);
    const a = laidOut.find((m) => m.id === "a")!;
    const b = laidOut.find((m) => m.id === "b")!;
    expect(a.labelTop).toBeCloseTo(50 - 35);
    expect(b.labelTop).toBeCloseTo(200 - 35);
  });

  it("stacks markers whose x-positions cluster together so their labels don't overlap", () => {
    const clustered = [marker({ id: "a", x: 100, y: 100 }), marker({ id: "b", x: 130, y: 100 })];
    const laidOut = resolveMarkers(clustered, 0, 300);
    const tops = laidOut.map((m) => m.labelTop).sort((x, y) => x - y);
    expect(tops[1] - tops[0]).toBeGreaterThanOrEqual(30 + 5 - 0.01);
  });

  it("keeps clustered markers at different curve heights near their own y", () => {
    const clustered = [marker({ id: "a", x: 100, y: 80 }), marker({ id: "b", x: 120, y: 180 })];
    const laidOut = resolveMarkers(clustered, 0, 300);
    const a = laidOut.find((m) => m.id === "a")!;
    const b = laidOut.find((m) => m.id === "b")!;
    expect(a.labelTop).toBeCloseTo(80 - 35);
    expect(b.labelTop).toBeCloseTo(180 - 35);
  });

  it("clamps a crowded same-y cluster while preserving order", () => {
    const crowded = Array.from({ length: 6 }, (_, i) => marker({ id: `m${i}`, x: 100, y: 150 }));
    const laidOut = resolveMarkers(crowded, 0, 200);
    const maxBottom = 198;
    for (const m of laidOut) {
      expect(m.labelTop).toBeGreaterThanOrEqual(2);
      expect(m.labelTop + 30).toBeLessThanOrEqual(maxBottom + 0.01);
    }
  });

  it("shifts an overflowing stack to stay within [plotTop, plotBottom] rather than clipping", () => {
    // Natural position is far above plotTop (0) - the stack must shift down to fit, not just
    // clip the first marker off-canvas.
    const overflowing = [marker({ id: "a", x: 100, yHigh: 5 }), marker({ id: "b", x: 105, yHigh: 5 })];
    const laidOut = resolveMarkers(overflowing, 0, 300);
    for (const m of laidOut) expect(m.labelTop).toBeGreaterThanOrEqual(2 - 0.01);
  });

  it("falls back to center y for natural position", () => {
    const [laidOut] = resolveMarkers([marker({ yHigh: undefined, y: 60 })], 0, 300);
    expect(laidOut.labelTop).toBeCloseTo(60 - 35);
  });
});

describe("renderLaidOutMarker", () => {
  it("draws a dot, an error bar, a label box, and two lines of text", () => {
    const target = new SvgDrawTarget();
    const [laidOut] = resolveMarkers([marker({})], 0, 300);
    renderLaidOutMarker(target, laidOut);
    const svg = target.serialize();
    expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(2); // halo + colored dot
    expect(svg).toContain("<rect"); // label box
    expect((svg.match(/<text/g) ?? []).length).toBe(2);
    expect(svg).toContain(">a<"); // line1
    expect(svg).toContain(">b<"); // line2
  });

  it("omits the error-bar ticks' visual distinction when yLow/yHigh equal y (no CI)", () => {
    const target = new SvgDrawTarget();
    const [laidOut] = resolveMarkers([marker({ yLow: undefined, yHigh: undefined, y: 100 })], 0, 300);
    // Should not throw, and should still render the dot/label.
    expect(() => renderLaidOutMarker(target, laidOut)).not.toThrow();
    expect(target.serialize()).toContain("<rect");
  });
});
