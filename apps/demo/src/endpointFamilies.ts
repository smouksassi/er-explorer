/**
 * ADR-0013 model-family adapters — the ONLY place family-specific math for
 * fitted values and observed summaries may live. Pipelines (projections,
 * readout, callouts) select an adapter and never branch on family themselves
 * (invariant I7). Adding Emax / ordinal / bounded smoothers = adding an adapter
 * here + the conformance matrix; zero pipeline changes.
 */

import type { EndpointFamilyAdapter, ObservedGroupSummary } from "@er-explorer/domain";
import { wilsonScoreInterval } from "@er-explorer/analysis";
import { meanConfidenceInterval, type LinearParams } from "@er-explorer/model-linear";

export interface LogisticParams {
  intercept: number;
  slope: number;
}

export const logisticFamily: EndpointFamilyAdapter<LogisticParams> = {
  familyId: "logistic",
  readoutDecimals: 3,
  formatValue: (v) => `${Math.round(v * 100)}%`,
  fittedAt: (m, x) => 1 / (1 + Math.exp(-(m.intercept + m.slope * x))),
  observedSummary(responses): ObservedGroupSummary | null {
    if (!responses.length) return null;
    const responders = responses.filter((r) => r === 1).length;
    const ci = wilsonScoreInterval(responders, responses.length);
    return {
      center: ci.proportion,
      lower: ci.lower,
      upper: ci.upper,
      n: responses.length,
      primaryLabel: `${Math.round(ci.proportion * 100)}%`,
      secondaryLabel: `${responders}/${responses.length}`
    };
  }
};

export const linearFamily: EndpointFamilyAdapter<LinearParams> = {
  familyId: "linear",
  readoutDecimals: 1,
  formatValue: (v) => (Number.isFinite(v) ? v.toFixed(1) : "—"),
  fittedAt: (m, x) => m.intercept + m.slope * x,
  observedSummary(responses): ObservedGroupSummary | null {
    if (!responses.length) return null;
    const mci = meanConfidenceInterval(responses);
    return {
      center: mci.mean,
      lower: mci.lower,
      upper: mci.upper,
      n: mci.n,
      primaryLabel: mci.mean.toFixed(1),
      secondaryLabel: `[${mci.lower.toFixed(1)}–${mci.upper.toFixed(1)}] N=${mci.n}`
    };
  }
};
