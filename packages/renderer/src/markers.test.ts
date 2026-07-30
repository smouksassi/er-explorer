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

  it("places a single marker at its natural position (yHigh - 34)", () => {
    const [laidOut] = resolveMarkers([marker({ yHigh: 80 })], 0, 300);
    expect(laidOut.labelTop).toBeCloseTo(80 - 34);
  });

  it("keeps markers in separate x-clusters at their own natural positions", () => {
    const far = [marker({ id: "a", x: 0, yHigh: 50 }), marker({ id: "b", x: 500, yHigh: 200 })];
    const laidOut = resolveMarkers(far, 0, 300);
    const a = laidOut.find((m) => m.id === "a")!;
    const b = laidOut.find((m) => m.id === "b")!;
    expect(a.labelTop).toBeCloseTo(50 - 34);
    expect(b.labelTop).toBeCloseTo(200 - 34);
  });

  it("stacks markers whose x-positions cluster together so their labels don't overlap", () => {
    // Both markers want roughly the same natural vertical position (same x-cluster, same yHigh)
    // - without stacking, their 30px-tall label boxes would overlap.
    const clustered = [marker({ id: "a", x: 100, yHigh: 100 }), marker({ id: "b", x: 130, yHigh: 100 })];
    const laidOut = resolveMarkers(clustered, 0, 300);
    const tops = laidOut.map((m) => m.labelTop).sort((x, y) => x - y);
    expect(tops[1] - tops[0]).toBeGreaterThanOrEqual(30 + 5 - 0.01); // LABEL_HEIGHT + LABEL_GAP
  });

  it("spreads a crowded cluster evenly across the available range rather than overflowing it", () => {
    const crowded = Array.from({ length: 12 }, (_, i) => marker({ id: `m${i}`, x: 100, yHigh: 150 }));
    const laidOut = resolveMarkers(crowded, 0, 200);
    for (const m of laidOut) {
      expect(m.labelTop).toBeGreaterThanOrEqual(0);
      expect(m.labelTop).toBeLessThanOrEqual(200);
    }
  });

  it("shifts an overflowing stack to stay within [plotTop, plotBottom] rather than clipping", () => {
    // Natural position is far above plotTop (0) - the stack must shift down to fit, not just
    // clip the first marker off-canvas.
    const overflowing = [marker({ id: "a", x: 100, yHigh: 5 }), marker({ id: "b", x: 105, yHigh: 5 })];
    const laidOut = resolveMarkers(overflowing, 0, 300);
    for (const m of laidOut) expect(m.labelTop).toBeGreaterThanOrEqual(2 - 0.01);
  });

  it("falls back to `y` for a marker with no yHigh (no CI to show)", () => {
    const [laidOut] = resolveMarkers([marker({ yHigh: undefined, y: 60 })], 0, 300);
    expect(laidOut.labelTop).toBeCloseTo(60 - 34);
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
