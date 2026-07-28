import { describe, expect, it } from "vitest";
import {
  detectBinary,
  detectCategorical,
  detectContinuous,
  inferVariableType,
  isNumericColumn,
  toNumeric
} from "./typeInference";

describe("toNumeric / isNumericColumn", () => {
  it("parses numbers and clean numeric strings, rejects non-numeric strings", () => {
    expect(toNumeric(3.5)).toBe(3.5);
    expect(toNumeric("3.5")).toBe(3.5);
    expect(toNumeric(" 12 ")).toBe(12);
    expect(toNumeric("3.5 mg")).toBeUndefined();
    expect(toNumeric("")).toBeUndefined();
    expect(toNumeric(null)).toBeUndefined();
  });

  it("treats a column as numeric only if every non-missing value parses", () => {
    expect(isNumericColumn([1, 2, "3", null])).toBe(true);
    expect(isNumericColumn([1, "two", 3])).toBe(false);
    expect(isNumericColumn([null, undefined, ""])).toBe(false); // nothing to base numeric-ness on
  });
});

describe("detectBinary", () => {
  it("detects exactly two distinct values regardless of type", () => {
    expect(detectBinary([1, 0, 1, 0, null])).toBe(true);
    expect(detectBinary(["Yes", "No", "Yes"])).toBe(true);
    expect(detectBinary([true, false, true])).toBe(true);
  });

  it("rejects columns with one or three+ distinct values", () => {
    expect(detectBinary([1, 1, 1])).toBe(false);
    expect(detectBinary([1, 2, 3])).toBe(false);
  });
});

describe("detectCategorical", () => {
  it("detects non-numeric multi-valued columns regardless of threshold", () => {
    expect(detectCategorical(["Normal", "Mild", "Severe", "Normal"], 1)).toBe(true);
  });

  it("detects low-cardinality numeric columns as categorical", () => {
    expect(detectCategorical([1, 2, 3, 1, 2, 3, 1], 5)).toBe(true);
  });

  it("does not call a high-cardinality numeric column categorical", () => {
    expect(detectCategorical([10, 20, 30, 40, 50], 3)).toBe(false);
  });

  it("does not call a binary (2-distinct-value) column categorical", () => {
    expect(detectCategorical([1, 0, 1, 0], 5)).toBe(false);
  });
});

describe("detectContinuous", () => {
  it("detects high-cardinality numeric columns", () => {
    expect(detectContinuous([45.2, 60.1, 88.9, 102.3, 30.0, 77.4], 3)).toBe(true);
  });

  it("rejects non-numeric columns", () => {
    expect(detectContinuous(["a", "b", "c", "d"], 2)).toBe(false);
  });

  it("rejects low-cardinality numeric columns", () => {
    expect(detectContinuous([1, 2, 1, 2, 1], 5)).toBe(false);
  });
});

describe("inferVariableType", () => {
  it("prioritizes binary over categorical/continuous", () => {
    const result = inferVariableType([1, 0, 1, 0, 1]);
    expect(result.type).toBe("binary");
    expect(result.distinctCount).toBe(2);
    expect(result.levels?.map((l) => l.value).sort()).toEqual(["0", "1"]);
  });

  it("infers continuous for high-cardinality numeric data", () => {
    const result = inferVariableType([45.2, 60.1, 88.9, 102.3, 30.0, 77.4], { categoricalNumericThreshold: 3 });
    expect(result.type).toBe("continuous");
    expect(result.levels).toBeUndefined();
  });

  it("infers nominal (categorical) for text labels", () => {
    const result = inferVariableType(["Normal", "Mild", "Severe", "Normal", "Mild"]);
    expect(result.type).toBe("nominal");
    expect(result.levels?.map((l) => l.value).sort()).toEqual(["Mild", "Normal", "Severe"]);
  });

  it("infers nominal for low-cardinality numeric codes under a small threshold", () => {
    const result = inferVariableType([1, 2, 3, 1, 2, 3], { categoricalNumericThreshold: 3 });
    expect(result.type).toBe("nominal");
  });

  it("falls back to nominal with no levels when everything is missing", () => {
    const result = inferVariableType([null, undefined, ""]);
    expect(result.type).toBe("nominal");
    expect(result.distinctCount).toBe(0);
  });
});
