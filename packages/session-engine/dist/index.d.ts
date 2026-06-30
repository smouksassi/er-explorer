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
export declare const createSessionMetadata: (createdBy: string, version: string) => SessionMetadata;
export declare const createSessionState: (datasetId: string, model: ModelDefinition, visualization: VisualizationSpec, filters?: Record<string, unknown>, settings?: Record<string, unknown>, metadata?: SessionMetadata) => SessionState;
//# sourceMappingURL=index.d.ts.map