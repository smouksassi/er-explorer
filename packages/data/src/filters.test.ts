import { describe, expect, it } from "vitest";
import type { Filter } from "@er-explorer/domain";
import { countMatchingRecords, matchesFilter, selectRecordIndices } from "./filters";
import { loadDataset } from "./loadedDataset";

const loaded = loadDataset([
  { SUBJID: "S1", AGE: 34, RENAL: "Normal" },
  { SUBJID: "S2", AGE: 45, RENAL: "Mild" },
  { SUBJID: "S3", AGE: 29, RENAL: null },
  { SUBJID: "S4", AGE: 52, RENAL: "Severe" }
]);

describe("matchesFilter", () => {
  it("evaluates numeric comparisons even when the stored value is a string", () => {
    expect(matchesFilter(loaded, 0, { variableId: "AGE", operator: ">=", value: 18 })).toBe(true);
    expect(matchesFilter(loaded, 2, { variableId: "AGE", operator: ">=", value: 30 })).toBe(false);
  });

  it("evaluates equality/in/not-in for categorical values", () => {
    expect(matchesFilter(loaded, 0, { variableId: "RENAL", operator: "=", value: "Normal" })).toBe(true);
    expect(matchesFilter(loaded, 1, { variableId: "RENAL", operator: "in", value: ["Mild", "Severe"] })).toBe(true);
    expect(matchesFilter(loaded, 0, { variableId: "RENAL", operator: "not-in", value: ["Mild", "Severe"] })).toBe(true);
  });

  it("evaluates between", () => {
    expect(matchesFilter(loaded, 0, { variableId: "AGE", operator: "between", value: [30, 40] })).toBe(true);
    expect(matchesFilter(loaded, 1, { variableId: "AGE", operator: "between", value: [30, 40] })).toBe(false);
  });

  it("never matches a missing observation, regardless of operator", () => {
    expect(matchesFilter(loaded, 2, { variableId: "RENAL", operator: "!=", value: "Normal" })).toBe(false);
  });
});

describe("selectRecordIndices / countMatchingRecords", () => {
  it("yields indices passing every filter (logical AND)", () => {
    const filters: Filter[] = [
      { variableId: "AGE", operator: ">=", value: 30 },
      { variableId: "RENAL", operator: "!=", value: "Severe" }
    ];
    expect([...selectRecordIndices(loaded, filters)]).toEqual([0, 1]);
    expect(countMatchingRecords(loaded, filters)).toBe(2);
  });

  it("with no filters, yields every row index", () => {
    expect([...selectRecordIndices(loaded)]).toEqual([0, 1, 2, 3]);
  });
});
