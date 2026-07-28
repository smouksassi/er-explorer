import { describe, expect, it } from "vitest";
import { loadDataset } from "./loadedDataset";
import { buildStudyDataset } from "./studyDataset";
import { summarizeMissingValues } from "./missingValues";

const loaded = loadDataset([
  { SUBJID: "S1", AUC: 45.2, ICGI: 1, RENAL: "Normal" },
  { SUBJID: "S2", AUC: 60.1, ICGI: 0, RENAL: "Mild" },
  { SUBJID: "S3", AUC: null, ICGI: 1, RENAL: "Severe" },
  { SUBJID: "S4", AUC: 88.9, ICGI: 0, RENAL: "Normal" }
]);

describe("summarizeMissingValues", () => {
  it("counts missing and present values", () => {
    const summary = summarizeMissingValues([1, null, 2, "", 3]);
    expect(summary.totalCount).toBe(5);
    expect(summary.missingCount).toBe(2);
    expect(summary.presentCount).toBe(3);
    expect(summary.missingFraction).toBe(0.4);
  });
});

describe("buildStudyDataset", () => {
  it("produces a domain StudyDataset with one Variable per column, inferred types, and role hints applied", () => {
    const { dataset, inferred } = buildStudyDataset({
      id: "ds1",
      name: "Test dataset",
      loaded,
      provenance: { source: "unit test", generatedAt: "2026-07-27T00:00:00.000Z" },
      roleHints: {
        AUC: { role: "exposure", label: "AUC", unit: "ng*h/mL" },
        ICGI: { role: "endpoint", label: "ICGI responder" },
        RENAL: { role: "covariate", label: "Renal function" }
      },
      categoricalNumericThreshold: 2
    });

    expect(dataset.id).toBe("ds1");
    expect(dataset.rowCount).toBe(4);
    expect(dataset.variables.map((v) => v.id)).toEqual(["SUBJID", "AUC", "ICGI", "RENAL"]);

    const auc = dataset.variables.find((v) => v.id === "AUC")!;
    expect(auc.role).toBe("exposure");
    expect(auc.unit).toBe("ng*h/mL");
    expect(auc.type).toBe("continuous");
    expect(auc.allowsMissing).toBe(true);

    const icgi = dataset.variables.find((v) => v.id === "ICGI")!;
    expect(icgi.role).toBe("endpoint");
    expect(icgi.type).toBe("binary");
    expect(icgi.allowsMissing).toBe(false);

    const subjid = dataset.variables.find((v) => v.id === "SUBJID")!;
    expect(subjid.role).toBe("administrative"); // no hint supplied -> default

    expect(inferred.AUC.missing.missingCount).toBe(1);
    expect(inferred.AUC.distinctCount).toBe(3);
  });

  it("never mutates the LoadedDataset it reads from", () => {
    const before = loaded.columns;
    buildStudyDataset({
      id: "ds1",
      name: "Test dataset",
      loaded,
      provenance: { source: "unit test", generatedAt: "2026-07-27T00:00:00.000Z" }
    });
    expect(loaded.columns).toBe(before);
    expect(Object.isFrozen(loaded)).toBe(true);
  });
});
