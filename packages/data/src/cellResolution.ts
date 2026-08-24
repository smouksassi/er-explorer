/**
 * ADR-0012 bridge: build `CellResolutionInput` for the domain's
 * `resolveCellContext` from a `LoadedDataset`, and resolve enumerated panels
 * into `ResolvedCellContext`s in one call.
 *
 * Level models — for the color variable AND every declared grouping variable —
 * are built ONCE on the layout's base cohort (all filtered rows), not per panel:
 * median/tertile cut points for a numeric covariate must mean the same thing in
 * every cell, otherwise "≤ 105.5" would silently shift between facets.
 */

import type {
  CellResolutionInput,
  ResolvedCellContext,
  ScatterPanelSpec,
  ViewLayoutSpec
} from "@er-explorer/domain";
import { DOSE_GROUPING_ID, resolveCellContext, resolveGrouping } from "@er-explorer/domain";
import type { LoadedDataset } from "./loadedDataset";
import { buildVariableLevelModel, levelForRow, type VariableLevelModel } from "./variableBins";

/** Dose-role access (labels live in the demo's column mapping, not this package). */
export interface DoseGroupingAccess {
  levels: readonly string[];
  forRow(rowIndex: number): string | null;
}

export interface CellResolver {
  /** Resolve one enumerated scatter panel into its cell context. */
  resolve(panel: ScatterPanelSpec): ResolvedCellContext;
  /** Ordered levels of the color variable on the base cohort (empty when color ≠ variable). */
  colorLevels: string[];
  /** The shared bin model (undefined when color ≠ variable). */
  colorModel?: VariableLevelModel;
}

/**
 * Base-cohort level models for the color variable and every declared grouping
 * variable (deduped — the common grouping-by-the-color-variable case shares one
 * model, so cuts can never disagree between paint and fits).
 */
function buildLevelModels(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  baseRowIndices: number[]
): Map<string, VariableLevelModel> {
  const models = new Map<string, VariableLevelModel>();
  const wanted = new Set(resolveGrouping(spec).filter((id) => id !== DOSE_GROUPING_ID));
  if (spec.color.kind === "variable") wanted.add(spec.color.variableId);
  for (const variableId of wanted) {
    models.set(
      variableId,
      buildVariableLevelModel(
        loaded,
        variableId,
        baseRowIndices,
        (spec.color.kind === "variable" && spec.color.variableId === variableId
          ? spec.color.binning
          : undefined) ?? spec.continuousBinning
      )
    );
  }
  return models;
}

function inputFor(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  models: Map<string, VariableLevelModel>,
  panel: CellResolutionInput["panel"],
  dose?: DoseGroupingAccess
): CellResolutionInput {
  const accessor = (variableId: string, rowIndex: number): string | null => {
    const model = models.get(variableId);
    if (!model) return null;
    const level = levelForRow(rowIndex, model, loaded, variableId);
    return level === "" ? null : level;
  };
  const colorModel = spec.color.kind === "variable" ? models.get(spec.color.variableId) : undefined;
  return {
    spec,
    panel,
    selectedEndpointIds,
    colorLevels: colorModel?.levels,
    levelForRow: colorModel ? accessor : undefined,
    groupingLevels: (variableId) => models.get(variableId)?.levels,
    groupingLevelForRow: accessor,
    doseLevels: dose?.levels,
    doseForRow: dose ? (i) => dose.forRow(i) : undefined
  };
}

/**
 * Prepare a resolver for the current layout: shared base-cohort level models,
 * then per-panel `resolveCellContext` calls.
 */
export function createCellResolver(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  baseRowIndices: number[],
  dose?: DoseGroupingAccess
): CellResolver {
  const models = buildLevelModels(loaded, spec, baseRowIndices);
  const colorModel = spec.color.kind === "variable" ? models.get(spec.color.variableId) : undefined;
  return {
    resolve: (panel) =>
      resolveCellContext(inputFor(loaded, spec, selectedEndpointIds, models, panel, dose)),
    colorLevels: colorModel?.levels ? [...colorModel.levels] : [],
    colorModel
  };
}

/** Convenience: resolve every enumerated panel with one shared resolver. */
export function resolveCellContexts(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  baseRowIndices: number[],
  panels: ScatterPanelSpec[],
  dose?: DoseGroupingAccess
): ResolvedCellContext[] {
  const resolver = createCellResolver(loaded, spec, selectedEndpointIds, baseRowIndices, dose);
  return panels.map((p) => resolver.resolve(p));
}

/** Expose the input builder for callers that need custom panel shapes (demo compare paths during migration). */
export function buildCellResolutionInput(
  loaded: LoadedDataset,
  spec: ViewLayoutSpec,
  selectedEndpointIds: readonly string[],
  baseRowIndices: number[],
  panel: CellResolutionInput["panel"],
  dose?: DoseGroupingAccess
): CellResolutionInput {
  return inputFor(loaded, spec, selectedEndpointIds, buildLevelModels(loaded, spec, baseRowIndices), panel, dose);
}
