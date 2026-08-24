import { describe, expect, it } from "vitest";
import { loadDataset } from "./loadedDataset";
import { binLabelsForCuts, buildVariableLevelModel, levelForRow } from "./variableBins";

describe("variableBins — missing values never enter cut points (QA round 13)", () => {
  // 20 non-missing values 1..20 (true median 10.5) + 10 missing. The old code
  // coerced missing to 0 (Number(null) === 0), dragging the cut toward zero —
  // caught only by the user's external R cross-check (crcl 92.5 vs true 105.5).
  const vals: Array<number | null> = [
    ...Array.from({ length: 20 }, (_, i) => i + 1),
    ...Array<null>(10).fill(null)
  ];
  const loaded = loadDataset(
    new Map<string, Array<number | null>>([
      ["id", vals.map((_, i) => i + 1)],
      ["crcl", vals]
    ])
  );
  const rows = vals.map((_, i) => i);

  it("median cut computed on non-missing values only; label carries the value", () => {
    const model = buildVariableLevelModel(loaded, "crcl", rows, "median");
    expect(model.cuts).toEqual([10.5]);
    expect(model.levels).toEqual(["≤ 10.5", "> 10.5", "(missing)"]);
  });

  it("missing rows land in the explicit (missing) level, never the lowest bin", () => {
    const model = buildVariableLevelModel(loaded, "crcl", rows, "median");
    expect(levelForRow(0, model, loaded, "crcl")).toBe("≤ 10.5");
    expect(levelForRow(19, model, loaded, "crcl")).toBe("> 10.5");
    expect(levelForRow(25, model, loaded, "crcl")).toBe("(missing)");
  });

  it("tertile/quartile labels carry all cut values", () => {
    expect(binLabelsForCuts([92.7, 119.2])).toEqual(["≤ 92.7", "92.7–119.2", "> 119.2"]);
    expect(binLabelsForCuts([87])).toEqual(["≤ 87", "> 87"]);
  });
});

describe("explicit missing level (QA round 12 ruling)", () => {
  const vals: Array<number | null> = [
    ...Array.from({ length: 20 }, (_, i) => i + 1),
    ...Array<null>(10).fill(null)
  ];
  const loaded = loadDataset(
    new Map<string, Array<number | null>>([
      ["id", vals.map((_, i) => i + 1)],
      ["crcl", vals]
    ])
  );
  const rows = vals.map((_, i) => i);

  it("(missing) is a first-class level, ordered LAST; missing rows are assigned to it", () => {
    const model = buildVariableLevelModel(loaded, "crcl", rows, "median");
    expect(model.levels).toEqual(["≤ 10.5", "> 10.5", "(missing)"]);
    expect(model.hasMissing).toBe(true);
    expect(levelForRow(25, model, loaded, "crcl")).toBe("(missing)");
    // Cut points still exclude missing (the QA round 13 rule is independent).
    expect(model.cuts).toEqual([10.5]);
  });

  it("no missing level when the cohort has none", () => {
    const clean = loadDataset(
      new Map<string, number[]>([
        ["id", Array.from({ length: 20 }, (_, i) => i + 1)],
        ["crcl", Array.from({ length: 20 }, (_, i) => i + 1)]
      ])
    );
    const model = buildVariableLevelModel(clean, "crcl", Array.from({ length: 20 }, (_, i) => i), "median");
    expect(model.levels).toEqual(["≤ 10.5", "> 10.5"]);
    expect(model.hasMissing).toBeFalsy();
  });
});
