export type ModelKind = "logistic" | "linear" | "ordinal" | "time-to-event";
export interface ModelDefinition {
    id: string;
    kind: ModelKind;
    description: string;
}
export interface FitResult {
    model: ModelDefinition;
    coefficients: Record<string, number>;
    statistics: Record<string, number>;
}
export interface PredictionRequest {
    exposures: Array<Record<string, number | string>>;
    covariates?: Record<string, number | string>;
}
export interface PredictionResult {
    estimates: Array<Record<string, number>>;
    metadata: Record<string, unknown>;
}
export declare const createModelDefinition: (id: string, kind: ModelKind, description: string) => ModelDefinition;
export declare const createPredictionRequest: (exposures: Array<Record<string, number | string>>, covariates?: Record<string, number | string>) => PredictionRequest;
//# sourceMappingURL=index.d.ts.map