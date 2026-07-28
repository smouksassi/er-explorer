import type { DatasetProvenance, StudyDataset } from "@er-explorer/domain";
import type { LoadedDataset } from "./loadedDataset";
import { getColumn } from "./loadedDataset";
import { inferVariableMetadata, type InferredVariable, type VariableRoleHint } from "./variableMetadata";

export interface BuildStudyDatasetInput {
  id: string;
  name: string;
  loaded: LoadedDataset;
  provenance: DatasetProvenance;
  description?: string;
  /** Role/label/unit/description overrides per variable id, for columns whose scientific role is known (e.g. marking `AUCss` as an `"exposure"`). Columns without a hint default to `role: "administrative"`. */
  roleHints?: Record<string, VariableRoleHint>;
  /** Distinct-value cutoff separating a low-cardinality numeric column (categorical) from a continuous one, applied to every column. See {@link DEFAULT_CATEGORICAL_NUMERIC_THRESHOLD} in typeInference.ts. */
  categoricalNumericThreshold?: number;
}

export interface BuiltStudyDataset {
  /** The `@er-explorer/domain` StudyDataset: schema and provenance only, ready to embed in a Workspace/SessionFile. */
  dataset: StudyDataset;
  /** Every column's full inference detail (distinct count, missing summary), keyed by variable id, for callers that want more than the plain Variable carries. */
  inferred: Record<string, InferredVariable>;
}

/**
 * Build a `@er-explorer/domain` {@link StudyDataset} - the schema/provenance
 * shape other packages (session-engine, and eventually a UI) consume - by
 * running automatic type inference over every column of a {@link LoadedDataset}.
 *
 * This only ever reads `loaded`; it never mutates it and never copies its
 * column arrays - the returned `StudyDataset.variables` is metadata
 * (ids, types, levels, stats) derived *from* the data, not the data itself.
 */
export function buildStudyDataset(input: BuildStudyDatasetInput): BuiltStudyDataset {
  const inferred: Record<string, InferredVariable> = {};

  const variables = input.loaded.variableOrder.map((variableId) => {
    const metadata = inferVariableMetadata(variableId, getColumn(input.loaded, variableId), {
      roleHint: input.roleHints?.[variableId],
      categoricalNumericThreshold: input.categoricalNumericThreshold
    });
    inferred[variableId] = metadata;
    return metadata;
  });

  const dataset: StudyDataset = {
    id: input.id,
    name: input.name,
    variables,
    rowCount: input.loaded.rowCount,
    provenance: input.provenance,
    description: input.description
  };

  return { dataset, inferred };
}
