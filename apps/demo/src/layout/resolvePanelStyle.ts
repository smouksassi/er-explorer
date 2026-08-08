import type { ScatterPanelSpec, ViewLayoutSpec } from "@er-explorer/domain";
import { resolvePanelVisualPolicy } from "@er-explorer/domain";

/** Resolve visual policy when only scatter panel id is known (facet grid paint). */
export function policyForScatterPanelId(
  spec: ViewLayoutSpec | null | undefined,
  panelById: Map<string, ScatterPanelSpec>,
  panelId: string | undefined,
  selectedEndpointIds: readonly string[]
) {
  if (!spec || !panelId) return null;
  const panel = panelById.get(panelId);
  if (!panel) return null;
  return resolvePanelVisualPolicy(spec, panel, selectedEndpointIds);
}

/** Policy for layout-wide chrome (legend, status dose labels) from spec + selection. */
export function policyForLayoutChrome(
  spec: ViewLayoutSpec | null | undefined,
  selectedEndpointIds: readonly string[]
) {
  if (!spec || !selectedEndpointIds.length) return null;
  const primary = selectedEndpointIds[0]!;
  return resolvePanelVisualPolicy(
    spec,
    {
      facetKey: {},
      endpointId: primary,
      endpointIds: selectedEndpointIds.length > 1 ? [...selectedEndpointIds] : undefined
    },
    selectedEndpointIds
  );
}
