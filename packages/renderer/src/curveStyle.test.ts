import { describe, expect, it } from "vitest";
import { buildBandPath, SmoothStyle, StepStyle } from "./curveStyle";

const pts = [
  { x: 0, y: 10 },
  { x: 10, y: 20 },
  { x: 20, y: 5 }
];

describe("SmoothStyle", () => {
  it("builds a straight M/L path through every point in order", () => {
    expect(SmoothStyle.buildPath(pts)).toBe("M0.00,10.00 L10.00,20.00 L20.00,5.00");
  });

  it("returns an empty string for no points", () => {
    expect(SmoothStyle.buildPath([])).toBe("");
  });
});

describe("StepStyle", () => {
  it("holds the previous y until the next x, then jumps (step-after)", () => {
    const d = StepStyle.buildPath(pts);
    // M(0,10) -> hold at y=10 until x=10 -> jump to y=20 -> hold until x=20 -> jump to y=5
    expect(d).toBe("M0.00,10.00 L10.00,10.00 L10.00,20.00 L20.00,20.00 L20.00,5.00");
  });

  it("returns an empty string for no points", () => {
    expect(StepStyle.buildPath([])).toBe("");
  });
});

describe("buildBandPath", () => {
  const upper = [
    { x: 0, y: 5 },
    { x: 10, y: 8 }
  ];
  const lower = [
    { x: 0, y: 15 },
    { x: 10, y: 18 }
  ];

  it("closes a ribbon from upper-forward + lower-reversed, defaulting to SmoothStyle", () => {
    const d = buildBandPath(upper, lower);
    expect(d.startsWith("M0.00,5.00 L10.00,8.00")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // the lower path is traversed in reverse (from its last point back to its first)
    expect(d).toContain("L10.00,18.00 L0.00,15.00");
  });

  it("returns an empty string when either side has no points", () => {
    expect(buildBandPath([], lower)).toBe("");
    expect(buildBandPath(upper, [])).toBe("");
  });

  it("uses the supplied CurveStyle for both sides", () => {
    const d = buildBandPath(upper, lower, StepStyle);
    expect(d).not.toBe(buildBandPath(upper, lower, SmoothStyle));
  });
});
