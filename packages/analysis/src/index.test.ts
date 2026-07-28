import { describe, expect, it } from "vitest";
import type {
  AnalysisModel,
  AnalysisModelCapabilities,
  ConfidenceInterval,
  Diagnostic,
  FitOutcome,
  FitRequest,
  ModelRegistry,
  PredictionSurface
} from "./index";

/**
 * These tests exist to verify that the new plugin-architecture interfaces
 * are exported from `./index` and are actually implementable - not to test
 * any statistics. The fixtures below are trivial test doubles (constant
 * outputs, no real fitting math); building a real logistic/linear/Emax/...
 * plugin against `AnalysisModel` is deliberately out of scope for this
 * package (see legacyStatistics.ts and index.ts's module doc comment).
 */

interface FakeParams {
  intercept: number;
  slope: number;
}

const capabilities: AnalysisModelCapabilities = {
  confidenceIntervalMethods: ["wald", "bootstrap"],
  supportsCovariateAdjustment: false,
  requiresCensoringVariable: false
};

const fakeModel: AnalysisModel<FakeParams> = {
  id: "fake-logistic-v0",
  family: "logistic",
  label: "Fake logistic (test double)",
  capabilities,
  fit(request: FitRequest): FitOutcome<FakeParams> {
    return {
      params: { intercept: 0, slope: 1 },
      optimization: { algorithm: "fake", converged: true, iterations: request.exposures.length }
    };
  },
  predict(params: FakeParams): PredictionSurface {
    return {
      analysisModelId: "fake-logistic-v0",
      scale: "response",
      evaluate: (exposures: number[]) => exposures.map((exposure) => ({ exposure, estimate: params.intercept + params.slope * exposure }))
    };
  },
  diagnose(): Diagnostic[] {
    return [{ id: "converged", label: "Converged", severity: "info", value: 1 }];
  },
  confidenceInterval(_params, request): ConfidenceInterval[] {
    return request.exposures.map((exposure) => ({ exposure, method: request.method, level: request.level ?? 0.95, lower: 0, upper: 1 }));
  }
};

class InMemoryModelRegistry implements ModelRegistry {
  private readonly models = new Map<string, AnalysisModel>();

  register(model: AnalysisModel): void {
    if (this.models.has(model.id)) throw new Error(`Model "${model.id}" is already registered`);
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

describe("AnalysisModel", () => {
  it("is implementable as a self-describing plugin with fit/predict/diagnose/confidenceInterval", () => {
    const outcome = fakeModel.fit({ exposures: [0, 10, 20], responses: [0, 1, 1] });
    expect(outcome.optimization.converged).toBe(true);

    const surface = fakeModel.predict(outcome.params);
    expect(surface.evaluate([0, 10]).map((p) => p.estimate)).toEqual([0, 10]);

    const diagnostics = fakeModel.diagnose(outcome.params, { exposures: [0, 10, 20], responses: [0, 1, 1] });
    expect(diagnostics[0].id).toBe("converged");

    const ci = fakeModel.confidenceInterval(outcome.params, { exposures: [0, 10], method: "wald" });
    expect(ci).toHaveLength(2);
    expect(ci[0].method).toBe("wald");
  });
});

describe("ModelRegistry", () => {
  it("supports registering, looking up, and listing plugins by family", () => {
    const registry = new InMemoryModelRegistry();
    registry.register(fakeModel);

    expect(registry.get("fake-logistic-v0")).toBe(fakeModel);
    expect(registry.listByFamily("logistic")).toEqual([fakeModel]);
    expect(registry.listByFamily("cox")).toEqual([]);
    expect(registry.list()).toEqual([fakeModel]);

    registry.unregister("fake-logistic-v0");
    expect(registry.get("fake-logistic-v0")).toBeUndefined();
  });

  it("rejects registering a duplicate id (a reasonable implementation's own contract, not required by the interface itself)", () => {
    const registry = new InMemoryModelRegistry();
    registry.register(fakeModel);
    expect(() => registry.register(fakeModel)).toThrow();
  });
});
