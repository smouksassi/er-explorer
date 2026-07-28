import type { ModelDefinition } from "@er-explorer/statistical-engine";
import type { VisualizationSpec } from "@er-explorer/visualization-engine";

/**
 * @deprecated Pre-domain-model session shape used by `apps/demo`'s ad hoc
 * save/load feature. Kept unchanged (and still exported) so the demo app
 * keeps working without modification. New code should use `SessionFile`
 * (see `sessionFile.ts`) - the versioned, checksummed `.erx` reproducibility
 * format - instead of this type.
 */
export interface SessionMetadata {
  createdAt: string;
  createdBy: string;
  version: string;
}

/** @deprecated see {@link SessionMetadata}. */
export interface SessionState {
  datasetId: string;
  model: ModelDefinition;
  visualization: VisualizationSpec;
  filters: Record<string, unknown>;
  settings: Record<string, unknown>;
  metadata: SessionMetadata;
}

/** @deprecated see {@link SessionMetadata}. */
export const createSessionMetadata = (createdBy: string, version: string): SessionMetadata => ({
  createdAt: new Date().toISOString(),
  createdBy,
  version
});

/** @deprecated see {@link SessionMetadata}. */
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
 * Legacy session file (de)serialization
 *
 * ADR-0004: every analysis is reproduced via session files. This was the
 * first, minimal session file mechanism (dataset id, model definition,
 * filters, visualization spec, metadata) and is kept as-is for backward
 * compatibility with apps/demo. See sessionFile.ts / serialize.ts /
 * deserialize.ts for the current, versioned `.erx` reproducibility engine.
 * ---------------------------------------------------------------------- */

/** @deprecated see {@link SessionFileParseError} for the current engine's error type. */
export class InvalidSessionFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionFileError";
  }
}

/** @deprecated see {@link serializeSessionFile}. */
export function serializeSession(state: SessionState, pretty = true): string {
  return JSON.stringify(state, null, pretty ? 2 : undefined);
}

/** Parse and lightly validate a legacy session file. Throws InvalidSessionFileError on malformed input. @deprecated see {@link deserializeSessionFile}. */
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
