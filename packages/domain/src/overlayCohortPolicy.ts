import type { ScatterPanelSpec, ViewLayoutSpec } from "./viewLayout";
import { resolvePanelVisualPolicy } from "./panelVisualPolicy";

/** Which row set an overlay layer should use (demo maps scopes to row indices). */
export type OverlayCohortScope = "endpointAndMetric" | "panelFacet" | "colorLevelWithinPanel";

/** Per-layer cohort scope for scatter, distribution, and readout overlays. */
export interface OverlayCohortPolicy {
  /** Median/tertile/quartile x positions (not Min/Max display edges). */
  referenceSplitPositions: "endpointAndMetric";
  /** Min/Max vertical reference lines on scatter. */
  displayMinMax: "panelFacet";
  /** Observed %/N (or mean) markers at split x. */
  observedAtSplit: "panelFacet" | "colorLevelWithinPanel";
  /** N / N(%) on distribution rows at exposure splits. */
  splitAnnotationOnDist: "panelFacet" | "colorLevelWithinPanel";
}

/**
 * Resolve overlay cohort scopes from layout spec and one scatter panel.
 * Pure policy — no row indices or theme colors.
 *
 * See ADR-0011: split **positions** use endpoint×metric population; stats at those x
 * use panel facet (and per color level when color encoding is active in-cell).
 */
export function resolveOverlayCohortPolicy(
  spec: ViewLayoutSpec,
  panel: Pick<ScatterPanelSpec, "facetKey" | "endpointId" | "endpointIds">,
  selectedEndpointIds: readonly string[]
): OverlayCohortPolicy {
  const visual = resolvePanelVisualPolicy(spec, panel, selectedEndpointIds);
  const colorActiveInCell = visual.scatterPointColorSource === "variable";
  const observedScope: OverlayCohortPolicy["observedAtSplit"] = colorActiveInCell
    ? "colorLevelWithinPanel"
    : "panelFacet";
  const distSplitByColor =
    spec.distribution.colorDistShapes && spec.color.kind === "variable";
  const splitAnnScope: OverlayCohortPolicy["splitAnnotationOnDist"] =
    distSplitByColor || colorActiveInCell ? "colorLevelWithinPanel" : "panelFacet";

  return {
    referenceSplitPositions: "endpointAndMetric",
    displayMinMax: "panelFacet",
    observedAtSplit: observedScope,
    splitAnnotationOnDist: splitAnnScope
  };
}
