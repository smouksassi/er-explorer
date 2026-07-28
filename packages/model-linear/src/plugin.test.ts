import { describe, expect, it } from "vitest";
import type { AnalysisModel, ModelRegistry } from "@er-explorer/analysis";
import { LINEAR_ANALYSIS_MODEL_ID, linearAnalysisModel } from "./plugin";

const exposures = [1, 2, 3, 4, 5, 6, 7, 8];
const responses = [5.1, 7.9, 11.2, 13.8, 17.0, 18.5, 22.1, 24.9]; // approx 2 + 3x

describe("linearAnalysisModel", () => {
  it("self-describes as the linear family with wald/bootstrap CI support", () => {
    expect(linearAnalysisModel.family).toBe("linear");
    expect(linearAnalysisModel.id).toBe(LINEAR_ANALYSIS_MODEL_ID);
    expect(linearAnalysisModel.capabilities.confidenceIntervalMethods).toEqual(["wald", "bootstrap"]);
  });

  it("fits, predicts, diagnoses, and computes both CI methods end to end", () => {
    const request = { exposures, responses };
    const outcome = linearAnalysisModel.fit(request);
    expect(outcome.optimization.converged).toBe(true);
    expect(outcome.params.slope).toBeCloseTo(3, 0);

    const surface = linearAnalysisModel.predict(outcome.params);
    expect(surface.scale).toBe("response");
    expect(surface.analysisModelId).toBe(LINEAR_ANALYSIS_MODEL_ID);
    const [pointAtFour] = surface.evaluate([4]);
    expect(pointAtFour.estimate).toBeCloseTo(outcome.params.intercept + outcome.params.slope * 4, 10);

    const diagnostics = linearAnalysisModel.diagnose(outcome.params, request);
    expect(diagnostics.find((d) => d.id === "r-squared")?.value).toBeGreaterThan(0.98);

    const wald = linearAnalysisModel.confidenceInterval(outcome.params, request, { exposures: [4], method: "wald" });
    expect(wald[0].lower).toBeLessThan(wald[0].upper);

    const bootstrap = linearAnalysisModel.confidenceInterval(outcome.params, request, {
      exposures: [4],
      method: "bootstrap",
      bootstrap: { resamples: 100, seed: 7, level: 0.95 }
    });
    expect(bootstrap[0].method).toBe("bootstrap");
    expect(bootstrap[0].lower).toBeLessThan(bootstrap[0].upper);
  });

  it("reports an error diagnostic and a degenerate fit for unfittable data, without throwing", () => {
    const request = { exposures: [1, 1, 1], responses: [1, 2, 3] }; // zero exposure variance
    const outcome = linearAnalysisModel.fit(request);
    expect(outcome.optimization.converged).toBe(false);
    expect(Number.isNaN(outcome.params.slope)).toBe(true);

    const diagnostics = linearAnalysisModel.diagnose(outcome.params, request);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

/** Minimal in-memory ModelRegistry test double - no concrete registry ships in @er-explorer/analysis yet, so this proves the plugin is registrable against the interface, not that any particular registry implementation exists. */
class InMemoryModelRegistry implements ModelRegistry {
  private readonly models = new Map<string, AnalysisModel>();
  register(model: AnalysisModel): void {
    this.models.set(model.id, model);
  }
  unregister(modelId: string): void {
    this.models.delete(modelId);
  }
  get(modelId: string): AnalysisModel | undefined {
    return this.models.get(modelId);
  }
  listByFamily(family: string): AnalysisModel[] {
    return [...this.models.values()].filter((m) => m.family === family);
  }
  list(): AnalysisModel[] {
    return [...this.models.values()];
  }
}

describe("registering linearAnalysisModel against a ModelRegistry", () => {
  it("can be registered and discovered by family", () => {
    const registry = new InMemoryModelRegistry();
    registry.register(linearAnalysisModel);

    expect(registry.get(LINEAR_ANALYSIS_MODEL_ID)).toBe(linearAnalysisModel);
    expect(registry.listByFamily("linear")).toEqual([linearAnalysisModel]);
    expect(registry.listByFamily("logistic")).toEqual([]);
  });
});
