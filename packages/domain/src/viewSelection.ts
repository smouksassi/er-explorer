/**
 * ADR-0012 serializable view selection — replaces the demo's parallel
 * `selectedDoses` Set + `selectedDistGroupIds` strings with one domain type
 * that sessions persist and every consumer (readout, projections, highlight)
 * derives from.
 *
 * A distribution-row click selects a dose, optionally narrowed to an endpoint
 * or a color-variable level (never both — a strip row is one or the other).
 * The DOM/legacy wire format is `dose` or `dose|suffix`; parsing needs the
 * known endpoint ids to disambiguate an endpoint suffix from a level suffix.
 */

/** One selected distribution row. */
export interface DistGroupRef {
  dose: string;
  /** Set when the row is a per-endpoint sub-row (endpoint-split strip). */
  endpointId?: string;
  /** Set when the row is a color-variable sub-row (`dose × level`). */
  level?: string;
}

/** Whole-view selection state; serializable into `.erx` sessions. */
export interface ViewSelection {
  /** Doses selected as whole arms (plain dose rows or scatter interactions). */
  selectedDoses: string[];
  /** Split rows selected (`dose × endpoint` or `dose × level`). */
  selectedDistGroups: DistGroupRef[];
}

export function emptyViewSelection(): ViewSelection {
  return { selectedDoses: [], selectedDistGroups: [] };
}

/** Wire format used in DOM `data-group` attributes and legacy sessions. */
export function formatDistGroupId(ref: DistGroupRef): string {
  const suffix = ref.endpointId ?? ref.level;
  return suffix === undefined ? ref.dose : `${ref.dose}|${suffix}`;
}

/**
 * Parse `dose` / `dose|suffix`. A suffix matching a known endpoint id is an
 * endpoint sub-row; anything else is a color-variable level. Dose labels may
 * themselves contain `|` only if they never collide with this format — the
 * first `|` is the separator by contract.
 */
export function parseDistGroupId(
  id: string,
  knownEndpointIds: readonly string[]
): DistGroupRef {
  const sep = id.indexOf("|");
  if (sep === -1) return { dose: id };
  const dose = id.slice(0, sep);
  const suffix = id.slice(sep + 1);
  if (knownEndpointIds.includes(suffix)) return { dose, endpointId: suffix };
  return { dose, level: suffix };
}

/** All doses the selection touches (whole arms plus split rows), deduplicated. */
export function selectedDoseUniverse(selection: ViewSelection): string[] {
  const doses = new Set(selection.selectedDoses);
  for (const g of selection.selectedDistGroups) doses.add(g.dose);
  return [...doses];
}

function refsEqual(a: DistGroupRef, b: DistGroupRef): boolean {
  return a.dose === b.dose && a.endpointId === b.endpointId && a.level === b.level;
}

/** Toggle a split row in/out of the selection (dist-row click semantics). */
export function toggleDistGroup(selection: ViewSelection, ref: DistGroupRef): ViewSelection {
  const exists = selection.selectedDistGroups.some((g) => refsEqual(g, ref));
  return {
    ...selection,
    selectedDistGroups: exists
      ? selection.selectedDistGroups.filter((g) => !refsEqual(g, ref))
      : [...selection.selectedDistGroups, ref]
  };
}

/** Toggle a whole dose arm in/out of the selection. */
export function toggleDose(selection: ViewSelection, dose: string): ViewSelection {
  const exists = selection.selectedDoses.includes(dose);
  return {
    ...selection,
    selectedDoses: exists
      ? selection.selectedDoses.filter((d) => d !== dose)
      : [...selection.selectedDoses, dose]
  };
}
