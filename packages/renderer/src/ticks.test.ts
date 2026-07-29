import { describe, expect, it } from "vitest";
import { formatTickValue, tickPositions } from "./ticks";

describe("tickPositions", () => {
  it("produces evenly-spaced ticks including both domain endpoints", () => {
    expect(tickPositions([0, 100], 5)).toEqual([0, 25, 50, 75, 100]);
  });

  it("falls back to the domain midpoint for count <= 1", () => {
    expect(tickPositions([0, 100], 1)).toEqual([50]);
  });
});

describe("formatTickValue", () => {
  it("prints integers without a decimal", () => {
    expect(formatTickValue(0)).toBe("0");
    expect(formatTickValue(1)).toBe("1");
  });

  it("prints values >= 100 with no decimal places", () => {
    expect(formatTickValue(123.456)).toBe("123");
  });

  it("prints values < 100 with one decimal place", () => {
    expect(formatTickValue(12.3)).toBe("12.3");
  });
});
