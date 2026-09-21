/**
 * The ONE eligibility rule behind both the Endpoint Models option list and
 * `fitForCohort`'s fall-through (ADR-0013). These are cheap assertions on a
 * declaration, but they pin decisions that are easy to erode one convenient
 * exception at a time — and one of them (loess leaving binary) is the whole
 * point of the GAM family.
 */
import { describe, expect, it } from "vitest";
import {
  MODELS_BY_DATA_KIND,
  MODEL_LABELS,
  type EndpointAnalysisModel
} from "./endpointAnalysis";

/** Mirrors `fitForCohort`'s resolution: an ineligible choice falls through to
 * the data kind's native family rather than erroring or fitting the wrong math. */
function resolveFamily(
  requested: EndpointAnalysisModel,
  kind: "binary" | "continuous"
): EndpointAnalysisModel {
  const eligible = MODELS_BY_DATA_KIND[kind];
  return eligible.includes(requested) ? requested : eligible[0]!;
}

describe("model eligibility by data kind", () => {
  it("offers loess on continuous endpoints ONLY", () => {
    // An unconstrained local regression cannot respect [0,1]; on real
    // icgi/AUC subgroups its point estimate reached 1.07. Replaced by GAM.
    expect(MODELS_BY_DATA_KIND.continuous).toContain("loess");
    expect(MODELS_BY_DATA_KIND.binary).not.toContain("loess");
  });

  it("offers gam on binary endpoints ONLY", () => {
    // The smooth lives on the logit scale — meaningless for a continuous response.
    expect(MODELS_BY_DATA_KIND.binary).toContain("gam");
    expect(MODELS_BY_DATA_KIND.continuous).not.toContain("gam");
  });

  it("offers emax on continuous endpoints ONLY", () => {
    expect(MODELS_BY_DATA_KIND.continuous).toContain("emax");
    expect(MODELS_BY_DATA_KIND.binary).not.toContain("emax");
  });

  it("lists each data kind's native family FIRST (it is the fall-through target)", () => {
    expect(MODELS_BY_DATA_KIND.binary[0]).toBe("logistic");
    expect(MODELS_BY_DATA_KIND.continuous[0]).toBe("linear");
  });

  it("labels every family, with no orphan labels", () => {
    const declared = [...MODELS_BY_DATA_KIND.binary, ...MODELS_BY_DATA_KIND.continuous].sort();
    expect(Object.keys(MODEL_LABELS).sort()).toEqual(declared);
  });

  it("assigns every family to exactly one data kind", () => {
    const overlap = MODELS_BY_DATA_KIND.binary.filter((m) =>
      MODELS_BY_DATA_KIND.continuous.includes(m)
    );
    expect(overlap).toEqual([]);
  });
});

describe("stale session fall-through (no migration path, by design)", () => {
  it("falls a stale binary 'loess' back to logistic", () => {
    // The exact case the loess→GAM replacement creates. Decision 5: no
    // dedicated migration, the generic rule covers it.
    expect(resolveFamily("loess", "binary")).toBe("logistic");
  });

  it("falls 'gam' on a continuous endpoint back to linear", () => {
    expect(resolveFamily("gam", "continuous")).toBe("linear");
  });

  it("falls 'emax' on a now-binary endpoint back to logistic", () => {
    expect(resolveFamily("emax", "binary")).toBe("logistic");
  });

  it("leaves every eligible choice untouched", () => {
    for (const kind of ["binary", "continuous"] as const) {
      for (const m of MODELS_BY_DATA_KIND[kind]) {
        expect(resolveFamily(m, kind)).toBe(m);
      }
    }
  });
});
