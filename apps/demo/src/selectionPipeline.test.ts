/**
 * UNIT-LEVEL conformance matrix (ADR-0013 / F4, invariant I7): the extracted
 * selection→projection pipeline executed directly per family — no DOM, no
 * dataset machinery. The SAME scenario must produce STRUCTURALLY IDENTICAL
 * output (group ids, curve keys, colors, exposure quantiles, Ns) for every
 * registered family; only the family-owned summary values may differ.
 */
import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "@er-explorer/domain";
import { resolveGrouping } from "@er-explorer/domain";
import {
  projectedSelectionGroups,
  summarizeDistribution,
  type SelectionProjectionCtx
} from "@er-explorer/analysis";
import { linearFamily, logisticFamily } from "./endpointFamilies";

/**
 * Fake cohort: 12 rows, two doses × alternating sex levels.
 * Binary and continuous endpoint columns share the SAME rows and exposures, so
 * every structural output must be identical across families.
 */
const DOSES = ["600 mg", "2400 mg"];
const rowDose = (i: number) => (i < 6 ? "600 mg" : "2400 mg");
const rowSex = (i: number) => (i % 2 === 0 ? "1" : "2");
const rowExposure = (i: number) => 10 + i * 10;
const rowBinary = (i: number) => (i % 3 === 0 ? 0 : 1);
const rowContinuous = (i: number) => 20 + (i % 5);

const NEUTRAL = "#475569";
const LEVEL_COLORS: Record<string, string> = { "1": "#4e79a7", "2": "#f28e2b" };

function makeSpec(overrides: Partial<ViewLayoutSpec>): ViewLayoutSpec {
  return {
    mode: "advanced",
    rowDimensions: [],
    colDimensions: [],
    color: { kind: "variable", variableId: "sex" },
    grouping: { variableIds: [] },
    distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false },
    ...overrides
  };
}

function makeCtx(
  spec: ViewLayoutSpec,
  selection: { gids?: string[]; doses?: string[] }
): SelectionProjectionCtx {
  // Grouping accessors derived from the spec exactly as the demo does (§J):
  // level model per declared variable, composite key per row.
  const groupingIds = resolveGrouping(spec);
  const levelsFor = (vid: string) => (vid === "dose" ? DOSES : ["1", "2"]);
  const valueFor = (vid: string, i: number) => (vid === "dose" ? rowDose(i) : rowSex(i));
  let groupingKeys: string[] = groupingIds.length ? [""] : [];
  for (const vid of groupingIds) {
    groupingKeys = groupingKeys.flatMap((k) => levelsFor(vid).map((l) => (k ? `${k} · ${l}` : l)));
  }
  const groupingKeyForRow = (i: number): string | null => {
    if (!groupingIds.length) return null;
    let key = "";
    for (const vid of groupingIds) {
      const v = valueFor(vid, i);
      key = key ? `${key} · ${v}` : v;
    }
    return key;
  };
  return {
    spec,
    knownEndpointIds: ["bin", "cont"],
    selectedDistGroupIds: new Set(selection.gids ?? []),
    selectedDoses: new Set(selection.doses ?? []),
    showObservedSummary: true,
    colorModel: spec.color.kind === "variable" ? { levels: ["1", "2"] } : null,
    groupingKeys,
    groupingKeyForRow,
    doseForRow: (i) => rowDose(i),
    rowIndicesForDose: (dose) =>
      Array.from({ length: 12 }, (_, i) => i).filter((i) => rowDose(i) === dose),
    isActiveRow: () => true,
    exposureValue: rowExposure,
    endpointValue: (i, ep) => (ep === "bin" ? rowBinary(i) : rowContinuous(i)),
    levelForRow: (i) => rowSex(i),
    summarizeExposures: (vals) => summarizeDistribution(vals),
    colorForLevel: (level) => LEVEL_COLORS[level] ?? "#000000",
    colorForEndpoint: () => "#123456",
    colorForDose: () => "#8172b2",
    neutralColor: NEUTRAL
  };
}

/** Family-owned values stripped: what remains must be identical across families. */
function structural(groups: ReturnType<typeof projectedSelectionGroups>) {
  return groups.map((g) => ({
    groupId: g.groupId,
    curveKey: g.curveKey,
    label: g.label,
    color: g.color,
    n: g.n,
    q1: g.q1,
    median: g.median,
    q3: g.q3,
    min: g.min,
    max: g.max,
    hasSummary: !!g.observedSummary,
    summaryN: g.observedSummary?.n
  }));
}

const FAMILIES = [
  { name: "logistic (binary)", endpointId: "bin", family: logisticFamily },
  { name: "linear (continuous)", endpointId: "cont", family: linearFamily }
] as const;

const SCENARIOS: Array<{
  name: string;
  spec: ViewLayoutSpec;
  selection: { gids?: string[]; doses?: string[] };
  expectCurveKeys: string[];
  expectLabels: string[];
  expectColors: string[];
}> = [
  {
    name: "grouped curves + pooled dose click → I8 partition to group granularity",
    spec: makeSpec({ grouping: { variableIds: ["sex"] } }),
    selection: { doses: ["2400 mg"] },
    expectCurveKeys: ["1", "2"],
    expectLabels: ["2400 mg · 1", "2400 mg · 2"],
    expectColors: [LEVEL_COLORS["1"]!, LEVEL_COLORS["2"]!]
  },
  {
    name: "grouped curves + single level-row click → one group on its curve",
    spec: makeSpec({ grouping: { variableIds: ["sex"] } }),
    selection: { gids: ["2400 mg|1"] },
    expectCurveKeys: ["1"],
    expectLabels: ["2400 mg · 1"],
    expectColors: [LEVEL_COLORS["1"]!]
  },
  {
    name: "pooled curve + pooled click → one NEUTRAL group (one-channel law)",
    spec: makeSpec({}),
    selection: { doses: ["2400 mg"] },
    expectCurveKeys: [""],
    expectLabels: ["2400 mg"],
    expectColors: [NEUTRAL]
  },
  {
    name: "dose channel + pooled click → dose palette (only legal dose-color case)",
    spec: makeSpec({ color: { kind: "dose" } }),
    selection: { doses: ["600 mg"] },
    expectCurveKeys: [""],
    expectLabels: ["600 mg"],
    expectColors: ["#8172b2"]
  },
  {
    name: "legacy fitByColor spec migrates to grouping (persisted sessions)",
    spec: (() => {
      const legacy = makeSpec({});
      delete legacy.grouping;
      return { ...legacy, fitByColor: true };
    })(),
    selection: { doses: ["2400 mg"] },
    expectCurveKeys: ["1", "2"],
    expectLabels: ["2400 mg · 1", "2400 mg · 2"],
    expectColors: [LEVEL_COLORS["1"]!, LEVEL_COLORS["2"]!]
  }
];

describe("conformance matrix — selection pipeline per family (unit level)", () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const results = FAMILIES.map(({ endpointId, family }) => {
        const ctx = makeCtx(sc.spec, sc.selection);
        return structural(projectedSelectionGroups(ctx, endpointId, family));
      });
      const [binary, continuous] = results;
      // Family symmetry (I7): identical structure, always.
      expect(continuous).toEqual(binary);
      // Scenario expectations (I8 + I2 + §J labels).
      expect(binary!.map((g) => g.curveKey)).toEqual(sc.expectCurveKeys);
      expect(binary!.map((g) => g.label)).toEqual(sc.expectLabels);
      expect(binary!.map((g) => g.color)).toEqual(sc.expectColors);
      expect(binary!.every((g) => g.hasSummary && g.summaryN === g.n)).toBe(true);
    });
  }

  it("cohort intersection (I3): panel cohort restricts rows and Ns per family identically", () => {
    const cohort = [6, 7, 8]; // subset of 2400 mg rows
    const results = FAMILIES.map(({ endpointId, family }) => {
      const ctx = makeCtx(makeSpec({}), { doses: ["2400 mg"] });
      return structural(projectedSelectionGroups(ctx, endpointId, family, cohort));
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[0]![0]!.n).toBe(3);
  });
});
