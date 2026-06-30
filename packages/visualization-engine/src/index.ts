import type { ModelDefinition, PredictionResult } from "@er-explorer/statistical-engine";

export type RenderTarget = "svg" | "canvas";

export interface ChartOptions {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  renderTarget: RenderTarget;
  responsive?: boolean;
}

export interface VisualizationSpec {
  id: string;
  model: ModelDefinition;
  data: PredictionResult;
  options: ChartOptions;
}

export interface RenderResult {
  outputType: RenderTarget;
  content: string;
  metadata: Record<string, unknown>;
}

export const createVisualizationSpec = (id: string, model: ModelDefinition, data: PredictionResult, options: ChartOptions): VisualizationSpec => ({
  id,
  model,
  data,
  options
});

export const createRenderResult = (outputType: RenderTarget, content: string): RenderResult => ({
  outputType,
  content,
  metadata: {}
});
