import { describe, expect, it } from "vitest";
import type {
  Analysis,
  AnalysisSpec,
  AnalysisVisualizationConfig,
  Covariate,
  Endpoint,
  ExposureMetric,
  Prediction,
  Question,
  Selection,
  Session,
  StudyDataset,
  Variable,
  Workspace
} from "./index";

/**
 * These tests exist to verify that every interface promised by
 * packages/domain is actually exported from `./index` and shaped the way
 * its documentation claims. Because this package contains only types
 * (erased at runtime), the meaningful check happens at compile time: each
 * `const x: SomeInterface = { ... }` below only type-checks if the
 * interface still accepts this exact shape. `pnpm test` runs `tsc --noEmit`
 * before vitest for that reason - a renamed or removed field here will fail
 * the type-check step even though vitest's own transpile step does not
 * enforce types.
 *
 * The runtime assertions are intentionally light (shape/identity checks)
 * since there is no business logic in this package to exercise.
 */

const auc: ExposureMetric = {
  id: "AUCss",
  name: "AUCss",
  label: "Steady-state AUC",
  role: "exposure",
  type: "continuous",
  unit: "ng*h/mL",
  metricKind: "auc",
  transform: "log",
  interval: "steady-state",
  referenceValue: 0
};

const icgi: Endpoint = {
  id: "ICGI",
  name: "ICGI",
  label: "Clinical Global Impression - Improvement responder",
  role: "endpoint",
  type: "binary",
  levels: [
    { value: "0", label: "Non-responder" },
    { value: "1", label: "Responder" }
  ],
  endpointKind: "binary",
  directionality: "higher-is-better",
  responderDefinition: {
    description: "CGI-Improvement score of 1 or 2",
    comparator: "<=",
    threshold: 2
  },
  timepoint: "Week 8"
};

const renalFunction: Covariate = {
  id: "RENAL",
  name: "RENAL",
  label: "Renal function category",
  role: "covariate",
  type: "nominal",
  covariateRole: "subgroup",
  referenceLevel: "Normal"
};

const dataset: StudyDataset = {
  id: "pooled-eff-icgi",
  name: "Pooled efficacy analysis set",
  variables: [auc, icgi, renalFunction] as Variable[],
  rowCount: 704,
  provenance: {
    source: "Pooled Phase II/III, studies A-101/A-102",
    studyIds: ["A-101", "A-102"],
    generatedAt: "2026-07-01T00:00:00.000Z"
  }
};

const selection: Selection = {
  recordIds: ["subj-001", "subj-002"],
  source: "brush",
  label: "AUC in [45.2, 88.9]"
};

const question: Question = {
  id: "q1",
  description: "How does AUC relate to ICGI response across dose groups?",
  exposureMetricIds: [auc.id],
  endpointIds: [icgi.id],
  stratificationVariableIds: [],
  covariateIds: [renalFunction.id],
  filters: [{ variableId: "AGE", operator: ">=", value: 18, label: "Age >= 18" }],
  stratificationSplit: "tertile",
  ciMethod: "bootstrap",
  bootstrapConfig: { resamples: 300, seed: 12345, level: 0.95 }
};

const model: AnalysisSpec = {
  id: "spec1",
  modelFamily: "logistic",
  description: "Single-predictor logistic regression on log(AUC)",
  exposureTransform: "log",
  estimationMethod: "newton-raphson-irls",
  options: { ridge: 1e-6, maxIterations: 50 }
};

const prediction: Prediction = {
  id: "pred1",
  analysisSpecId: model.id,
  questionId: question.id,
  points: [
    { exposure: 45.2, estimate: 0.6, lower: 0.5, upper: 0.7, endpointId: icgi.id },
    { exposure: 88.9, estimate: 0.75, lower: 0.65, upper: 0.83, endpointId: icgi.id }
  ],
  ciMethod: "bootstrap",
  confidenceLevel: 0.95,
  diagnostics: { converged: true, iterations: 6, n: 704 },
  computedAt: "2026-07-24T07:11:03.000Z"
};

const visualizationConfig: AnalysisVisualizationConfig = {
  layout: "exposure-response-grid",
  showPoints: true,
  showFittedMarkers: true,
  showObservedMarkers: false,
  distributionMode: "boxplot"
};

const analysis: Analysis = {
  id: "a1",
  name: "AUC vs ICGI, logistic, bootstrap CI",
  question,
  model,
  prediction,
  visualizationConfig,
  createdAt: "2026-07-24T07:00:00.000Z",
  updatedAt: "2026-07-24T07:11:03.000Z"
};

const workspace: Workspace = {
  id: "ws1",
  dataset,
  analyses: [analysis],
  notes: [{ id: "n1", text: "Bootstrap CI matches Wald closely here.", author: "smouksassi", createdAt: "2026-07-24T07:12:00.000Z" }],
  exportHistory: [
    { id: "e1", kind: "svg-figure", analysisId: analysis.id, exportedAt: "2026-07-24T07:15:00.000Z", exportedBy: "smouksassi" }
  ],
  metadata: {
    name: "Compound X Phase II ER analysis",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-24T07:15:00.000Z"
  }
};

const session: Session = {
  id: "s1",
  workspaceId: workspace.id,
  activeAnalysisId: analysis.id,
  selection,
  reproducibility: { appVersion: "0.0.1", datasetChecksum: "abc123" },
  savedBy: "smouksassi",
  savedAt: "2026-07-24T07:16:00.000Z"
};

describe("@er-explorer/domain", () => {
  it("exports Variable-family interfaces that accept a fully-populated ExposureMetric/Endpoint/Covariate", () => {
    expect(auc.role).toBe("exposure");
    expect(icgi.role).toBe("endpoint");
    expect(renalFunction.role).toBe("covariate");
  });

  it("wires a StudyDataset from Variables without duplicating them", () => {
    expect(dataset.variables).toHaveLength(3);
    expect(dataset.variables.map((v) => v.id)).toEqual([auc.id, icgi.id, renalFunction.id]);
  });

  it("builds a Question referencing dataset variables by id", () => {
    expect(question.exposureMetricIds).toContain(auc.id);
    expect(question.endpointIds).toContain(icgi.id);
    expect(question.covariateIds).toContain(renalFunction.id);
  });

  it("assembles a full Analysis from Question + AnalysisSpec + Prediction + visualization config", () => {
    expect(analysis.question.id).toBe(question.id);
    expect(analysis.model.id).toBe(model.id);
    expect(analysis.prediction?.id).toBe(prediction.id);
    expect(analysis.visualizationConfig.layout).toBe("exposure-response-grid");
  });

  it("groups Analyses, notes, and export history under a Workspace", () => {
    expect(workspace.analyses).toHaveLength(1);
    expect(workspace.notes).toHaveLength(1);
    expect(workspace.exportHistory).toHaveLength(1);
    expect(workspace.dataset.id).toBe(dataset.id);
  });

  it("lets a Session snapshot a Workspace's active Analysis and Selection", () => {
    expect(session.workspaceId).toBe(workspace.id);
    expect(session.activeAnalysisId).toBe(analysis.id);
    expect(session.selection?.recordIds).toHaveLength(2);
  });
});
