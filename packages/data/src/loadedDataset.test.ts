import { describe, expect, it } from "vitest";
import { getColumn, loadDataset } from "./loadedDataset";

const rows = [
  { SUBJID: "S1", AUC: 45.2, ICGI: 1 },
  { SUBJID: "S2", AUC: 60.1, ICGI: 0 },
  { SUBJID: "S3", AUC: null, ICGI: 1 }
];

describe("loadDataset (row-oriented input)", () => {
  it("builds a column-oriented store preserving row order and column order", () => {
    const loaded = loadDataset(rows);
    expect(loaded.rowCount).toBe(3);
    expect(loaded.variableOrder).toEqual(["SUBJID", "AUC", "ICGI"]);
    expect(getColumn(loaded, "SUBJID")).toEqual(["S1", "S2", "S3"]);
    expect(getColumn(loaded, "AUC")).toEqual([45.2, 60.1, null]);
  });

  it("returns an empty array for an unknown column id rather than throwing", () => {
    const loaded = loadDataset(rows);
    expect(getColumn(loaded, "DOES_NOT_EXIST")).toEqual([]);
  });

  it("freezes the returned dataset, its columns map, and every column array", () => {
    const loaded = loadDataset(rows);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.columns)).toBe(true);
    expect(Object.isFrozen(getColumn(loaded, "AUC"))).toBe(true);
  });

  it("never reflects later mutation of the caller's original input array", () => {
    const mutableRows = [{ SUBJID: "S1", AUC: 10 }];
    const loaded = loadDataset(mutableRows);
    mutableRows[0].AUC = 999; // mutate caller's own object after loading
    mutableRows.push({ SUBJID: "S2", AUC: 1 });
    expect(getColumn(loaded, "AUC")).toEqual([10]); // engine's copy is unaffected
    expect(loaded.rowCount).toBe(1);
  });
});

describe("loadDataset (column-oriented input)", () => {
  it("accepts a Map of columns directly", () => {
    const loaded = loadDataset(
      new Map([
        ["SUBJID", ["S1", "S2"]],
        ["AUC", [10, 20]]
      ])
    );
    expect(loaded.rowCount).toBe(2);
    expect(getColumn(loaded, "AUC")).toEqual([10, 20]);
  });

  it("rejects columns of mismatched length", () => {
    expect(() =>
      loadDataset(
        new Map([
          ["SUBJID", ["S1", "S2"]],
          ["AUC", [10]]
        ])
      )
    ).toThrow(RangeError);
  });
});
