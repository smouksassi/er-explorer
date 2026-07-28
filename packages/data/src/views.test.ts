import { describe, expect, it } from "vitest";
import { getColumn, loadDataset } from "./loadedDataset";
import { queryLongView } from "./longView";
import { queryWideView } from "./wideView";

const loaded = loadDataset([
  { SUBJID: "S1", AUC: 45.2, CMAX: 5.1, ICGI: 1, ICGI2: "Yes", RENAL: "Normal" },
  { SUBJID: "S2", AUC: 60.1, CMAX: 6.2, ICGI: 0, ICGI2: "No", RENAL: "Mild" },
  { SUBJID: "S3", AUC: 88.9, CMAX: 7.8, ICGI: 1, ICGI2: "Yes", RENAL: "Severe" }
]);

describe("queryLongView", () => {
  it("produces one row per (record x exposure metric x endpoint) with covariates attached", () => {
    const view = queryLongView(loaded, {
      exposureMetricIds: ["AUC", "CMAX"],
      endpointIds: ["ICGI", "ICGI2"],
      covariateIds: ["RENAL"],
      identifierVariableId: "SUBJID"
    });

    expect(view.rowCount).toBe(3 * 2 * 2);
    const rows = view.toArray();
    expect(rows).toHaveLength(12);

    const s1Auc = rows.filter((r) => r.recordId === "S1" && r.exposureMetricId === "AUC");
    expect(s1Auc).toHaveLength(2); // one per endpoint
    expect(s1Auc.map((r) => r.endpointId).sort()).toEqual(["ICGI", "ICGI2"]);
    expect(s1Auc[0].exposureValue).toBe(45.2);
    expect(s1Auc[0].covariates.RENAL).toBe("Normal");
  });

  it("applies filters before faceting by exposure metric/endpoint", () => {
    const view = queryLongView(loaded, {
      exposureMetricIds: ["AUC"],
      endpointIds: ["ICGI"],
      filters: [{ variableId: "RENAL", operator: "!=", value: "Severe" }]
    });
    expect(view.rowCount).toBe(2); // S1 + S2 only, 1 metric x 1 endpoint each
    expect(view.toArray().map((r) => r.recordIndex)).toEqual([0, 1]);
  });

  it("is lazy: rows() can be iterated more than once and reflects the current dataset each time", () => {
    const view = queryLongView(loaded, { exposureMetricIds: ["AUC"], endpointIds: ["ICGI"] });
    const first = [...view.rows()];
    const second = [...view];
    expect(first).toEqual(second);
  });

  it("never mutates or copies the underlying LoadedDataset", () => {
    const before = getColumn(loaded, "AUC");
    queryLongView(loaded, { exposureMetricIds: ["AUC", "CMAX"], endpointIds: ["ICGI", "ICGI2"] }).toArray();
    expect(getColumn(loaded, "AUC")).toBe(before); // same array reference: not copied, not replaced
    expect(Object.isFrozen(loaded)).toBe(true);
  });
});

describe("queryWideView", () => {
  it("projects requested columns as row-oriented records", () => {
    const view = queryWideView(loaded, { variableIds: ["SUBJID", "AUC"] });
    expect(view.rowCount).toBe(3);
    expect(view.toArray()).toEqual([
      { recordIndex: 0, SUBJID: "S1", AUC: 45.2 },
      { recordIndex: 1, SUBJID: "S2", AUC: 60.1 },
      { recordIndex: 2, SUBJID: "S3", AUC: 88.9 }
    ]);
  });

  it("applies filters", () => {
    const view = queryWideView(loaded, {
      variableIds: ["SUBJID"],
      filters: [{ variableId: "AUC", operator: ">", value: 50 }]
    });
    expect(view.toArray()).toEqual([
      { recordIndex: 1, SUBJID: "S2" },
      { recordIndex: 2, SUBJID: "S3" }
    ]);
  });
});
