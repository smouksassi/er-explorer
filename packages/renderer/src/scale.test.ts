import { describe, expect, it } from "vitest";
import { scaleLinear } from "./scale";

describe("scaleLinear", () => {
  it("maps domain to range linearly", () => {
    const scale = scaleLinear([0, 100], [10, 210]);
    expect(scale(0)).toBeCloseTo(10);
    expect(scale(100)).toBeCloseTo(210);
    expect(scale(50)).toBeCloseTo(110);
  });

  it("supports an inverted (flipped) pixel range, as used for the y axis", () => {
    const scale = scaleLinear([0, 1], [300, 0]);
    expect(scale(0)).toBeCloseTo(300);
    expect(scale(1)).toBeCloseTo(0);
  });

  it("inverts a pixel position back to its domain value", () => {
    const scale = scaleLinear([0, 100], [10, 210]);
    expect(scale.invert(110)).toBeCloseTo(50);
  });

  it("exposes the domain and range it was constructed with", () => {
    const scale = scaleLinear([0, 1], [400, 0]);
    expect(scale.domain).toEqual([0, 1]);
    expect(scale.range).toEqual([400, 0]);
  });

  it("does not divide by zero for a zero-width domain", () => {
    const scale = scaleLinear([5, 5], [0, 100]);
    expect(Number.isFinite(scale(5))).toBe(true);
  });
});
