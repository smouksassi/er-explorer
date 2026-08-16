/**
 * ADR-0012 bridge: build `CellResolutionInput` for the domain's
 * `resolveCellContext` from a `LoadedDataset`, and resolve enumerated panels
 * into `ResolvedCellContext`s in one call.
 *
 * The bin model for a color variable is built ONCE on the layout's base cohort
 * (all filtered rows), not per panel — median/tertile cut points for a numeric
 * covariate must mean the same thing in every cell, otherwise "≤ median" would
 * silently shift between facets.
 */

import type {
  CellResolutionInput,
  ResolvedCellContext,
  ScatterPanelSpec,
  ViewLayoutSpec
} from "@er-explorer/domain";
import { resolveCellContext } from "@er-explorer/domain";
import type { LoadedDataset } from "./loadedDataset";
import { buildVariableLevelModel, levelForRow, type VariableLevelModel } from "./variableBins";

export interface CellResolver {
  /** Resolve one enumerated scatter panel into its cell context. */
  resolve(panel: ScatterPanelSpec): ResolvedCellContext;
  /** Ordered levels of the color variable on the base cohort (empty when color ≠ variable). */
  colorLevels: string[];
  /** The shared bin model (undefined when color ≠ variable). */
  colorModel?: VariableLevelModel;
}

/**
 * Prepare a resolver for the current layout: one shared color-level model on the
 * base cohort, then per-panel `resolveCellContext` calls.
 */
export function createCellResolver(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  baseRowIndices: number[]
): CellResolver {
  if (spec.color.kind !== "variable") {
    return {
      resolve: (panel) => resolveCellContext({ spec, panel, selectedEndpointIds }),
      colorLevels: []
    };
  }

  const variableId = spec.color.variableId;
  const model = buildVariableLevelModel(
    loaded,
    variableId,
    baseRowIndices,
    spec.color.binning ?? spec.continuousBinning
  );
  const accessor = (varId: string, rowIndex: number): string | null => {
    if (varId !== variableId) return null;
    const level = levelForRow(rowIndex, model, loaded, varId);
    return level === "" ? null : level;
  };

  return {
    resolve: (panel) =>
      resolveCellContext({
        spec,
        panel,
        selectedEndpointIds,
        colorLevels: model.levels,
        levelForRow: accessor
      }),
    colorLevels: model.levels,
    colorModel: model
  };
}

/** Convenience: resolve every enumerated panel with one shared resolver. */
export function resolveCellContexts(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  baseRowIndices: number[],
  panels: ScatterPanelSpec[]
): ResolvedCellContext[] {
  const resolver = createCellResolver(loaded, spec, selectedEndpointIds, baseRowIndices);
  return panels.map((p) => resolver.resolve(p));
}

/** Expose the input builder for callers that need custom panel shapes (demo compare paths during migration). */
export function buildCellResolutionInput(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  baseRowIndices: number[],
  panel: CellResolutionInput["panel"]
): CellResolutionInput {
  if (spec.color.kind !== "variable") return { spec, panel, selectedEndpointIds };
  const variableId = spec.color.variableId;
  const model = buildVariableLevelModel(
    loaded,
    variableId,
    baseRowIndices,
    spec.color.binning ?? spec.continuousBinning
  );
  return {
    spec,
    panel,
    selectedEndpointIds,
    colorLevels: model.levels,
    levelForRow: (varId, rowIndex) => {
      if (varId !== variableId) return null;
      const level = levelForRow(rowIndex, model, loaded, varId);
      return level === "" ? null : level;
    }
  };
}
