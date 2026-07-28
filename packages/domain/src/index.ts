/**
 * `@er-explorer/domain` - the scientific domain model for ER Explorer.
 *
 * This package establishes the shared vocabulary that every other ER
 * Explorer package (statistical engine, visualization engine, session
 * engine, and the demo/web application) is expected to speak. It contains
 * only TypeScript interfaces and type aliases describing the scientific
 * concepts behind exposure-response analysis - no runtime logic, no
 * statistical computation, and no rendering or framework code.
 *
 * `packages/domain` is the root dependency of the project: it must not
 * import from `@er-explorer/statistical-engine`, `@er-explorer/visualization-engine`,
 * `@er-explorer/session-engine`, React, or any renderer. Every other
 * package may depend on `@er-explorer/domain`; it depends on nothing in
 * this monorepo itself.
 *
 * The core pipeline this domain model realizes (`docs/ARCHITECTURE.md`):
 *
 * ```
 * StudyDataset -> Question -> AnalysisSpec -> Prediction -> Visualization -> Decision
 * ```
 *
 * captured end-to-end by {@link Analysis}, and grouped together with other
 * analyses, notes, and export history inside a {@link Workspace}, which a
 * {@link Session} can snapshot for reproducible reloading.
 */

export type { VariableRole, VariableType, VariableLevel, Variable } from "./variable";

export type { DatasetProvenance, StudyDataset } from "./studyDataset";

export type { ExposureMetricKind, ExposureTransform, ExposureMetric } from "./exposureMetric";

export type {
  EndpointKind,
  EndpointDirectionality,
  ResponderDefinition,
  Endpoint
} from "./endpoint";

export type { CovariateRole, Covariate } from "./covariate";

export type { SelectionSource, Selection } from "./selection";

export type {
  CIMethod,
  BootstrapConfig,
  StratificationSplit,
  Filter,
  Question
} from "./question";

export type { ModelFamily, ModelOptions, AnalysisSpec } from "./analysisSpec";

export type { PredictionPoint, ConvergenceDiagnostics, Prediction } from "./prediction";

export type { AnalysisVisualizationConfig, Analysis } from "./analysis";

export type { NoteEntry, ExportRecord, WorkspaceMetadata, Workspace } from "./workspace";

export type { ReproducibilityInfo, Session } from "./session";
