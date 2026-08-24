/**
 * UNIT-LEVEL conformance matrix (ADR-0013 / F4, invariant I7): the extracted
 * selection→projection pipeline executed directly per family — no DOM, no
 * dataset machinery. The SAME scenario must produce STRUCTURALLY IDENTICAL
 * output (group ids, colors, exposure quantiles, Ns) for every registered
 * family; only the family-owned summary values may differ.
 */
import { describe, expect, it } from "vitest";
import type { ViewLayoutSpec } from "@er-explorer/domain";
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
    fitByColor: false,
    distribution: { linkage: "mirror_scatter_grid", colorDistShapes: false },
    ...overrides
  };
}

function makeCtx(
  spec: ViewLayoutSpec,
  selection: { gids?: string[]; doses?: string[] }
): SelectionProjectionCtx {
  return {
    spec,
    knownEndpointIds: ["bin", "cont"],
    selectedDistGroupIds: new Set(selection.gids ?? []),
    selectedDoses: new Set(selection.doses ?? []),
    showObservedSummary: true,
    colorModel: spec.color.kind === "variable" ? { levels: ["1", "2"] } : null,
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
  expectGroupIds: string[];
  expectColors: string[];
}> = [
  {
    name: "split curves + pooled dose click → I8 expansion to level groups",
    spec: makeSpec({ fitByColor: true }),
    selection: { doses: ["2400 mg"] },
    expectGroupIds: ["2400 mg|1", "2400 mg|2"],
    expectColors: [LEVEL_COLORS["1"]!, LEVEL_COLORS["2"]!]
  },
  {
    name: "split curves + single level-row click → one group on its curve",
    spec: makeSpec({ fitByColor: true }),
    selection: { gids: ["2400 mg|1"] },
    expectGroupIds: ["2400 mg|1"],
    expectColors: [LEVEL_COLORS["1"]!]
  },
  {
    name: "pooled curve + pooled click → one NEUTRAL group (one-channel law)",
    spec: makeSpec({ fitByColor: false }),
    selection: { doses: ["2400 mg"] },
    expectGroupIds: ["2400 mg"],
    expectColors: [NEUTRAL]
  },
  {
    name: "dose channel + pooled click → dose palette (only legal dose-color case)",
    spec: makeSpec({ color: { kind: "dose" }, fitByColor: false }),
    selection: { doses: ["600 mg"] },
    expectGroupIds: ["600 mg"],
    expectColors: ["#8172b2"]
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
      // Scenario expectations (I8 + I2).
      expect(binary!.map((g) => g.groupId)).toEqual(sc.expectGroupIds);
      expect(binary!.map((g) => g.color)).toEqual(sc.expectColors);
      expect(binary!.every((g) => g.hasSummary && g.summaryN === g.n)).toBe(true);
    });
  }

  it("cohort intersection (I3): panel cohort restricts rows and Ns per family identically", () => {
    const cohort = [6, 7, 8]; // subset of 2400 mg rows
    const results = FAMILIES.map(({ endpointId, family }) => {
      const ctx = makeCtx(makeSpec({ fitByColor: false }), { doses: ["2400 mg"] });
      return structural(projectedSelectionGroups(ctx, endpointId, family, cohort));
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[0]![0]!.n).toBe(3);
  });
});
