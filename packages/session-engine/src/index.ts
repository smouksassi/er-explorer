import type { ModelDefinition } from "@er-explorer/statistical-engine";
import type { VisualizationSpec } from "@er-explorer/visualization-engine";

export interface SessionMetadata {
  createdAt: string;
  createdBy: string;
  version: string;
}

export interface SessionState {
  datasetId: string;
  model: ModelDefinition;
  visualization: VisualizationSpec;
  filters: Record<string, unknown>;
  settings: Record<string, unknown>;
  metadata: SessionMetadata;
}

export const createSessionMetadata = (createdBy: string, version: string): SessionMetadata => ({
  createdAt: new Date().toISOString(),
  createdBy,
  version
});

export const createSessionState = (
  datasetId: string,
  model: ModelDefinition,
  visualization: VisualizationSpec,
  filters: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
  metadata?: SessionMetadata
): SessionState => ({
  datasetId,
  model,
  visualization,
  filters,
  settings,
  metadata: metadata ?? createSessionMetadata("unknown", "0.0.1")
});
