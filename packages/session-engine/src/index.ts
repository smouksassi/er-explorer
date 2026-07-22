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

/* ---------------------------------------------------------------------- *
 * Session file (de)serialization
 *
 * ADR-0004: every analysis is reproduced via session files. A session file
 * is just the JSON serialization of a SessionState - the dataset id, model
 * definition, active filters, CI/bootstrap settings (including the
 * bootstrap seed, so a bootstrap CI can be regenerated identically), the
 * visualization spec, and metadata about when/by whom it was created.
 * ---------------------------------------------------------------------- */

export class InvalidSessionFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionFileError";
  }
}

export function serializeSession(state: SessionState, pretty = true): string {
  return JSON.stringify(state, null, pretty ? 2 : undefined);
}

/** Parse and lightly validate a session file. Throws InvalidSessionFileError on malformed input. */
export function parseSession(json: string): SessionState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new InvalidSessionFileError(`Session file is not valid JSON: ${(err as Error).message}`);
  }
  if (!data || typeof data !== "object") {
    throw new InvalidSessionFileError("Session file must contain a JSON object");
  }
  const record = data as Record<string, unknown>;
  const requiredKeys: Array<keyof SessionState> = ["datasetId", "model", "visualization", "filters", "settings", "metadata"];
  for (const key of requiredKeys) {
    if (!(key in record)) {
      throw new InvalidSessionFileError(`Session file is missing required field "${key}"`);
    }
  }
  if (typeof record.datasetId !== "string") {
    throw new InvalidSessionFileError('Session file field "datasetId" must be a string');
  }
  return record as unknown as SessionState;
}
