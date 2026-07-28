import { beforeEach, describe, expect, it } from "vitest";
import type { Analysis, Question, StudyDataset, Workspace } from "@er-explorer/domain";
import { createSessionFile } from "./sessionFile";
import { serializeSessionFile } from "./serialize";
import { deserializeSessionFile, SessionFileParseError } from "./deserialize";
import { SESSION_FILE_EXTENSION, SESSION_FILE_KIND } from "./sessionFile";
import { SESSION_FORMAT_VERSION } from "./version";
import { clearSessionMigrations, migrateSessionData, registerSessionMigration, UnsupportedSessionVersionError } from "./migrations";
import { canonicalize, computeChecksum } from "./checksum";
import { createUuidV4, isUuid } from "./uuid";
import { appendHistoryEntry, setActiveAnalysis, setSelection } from "./operations";
import { createSessionState, parseSession, serializeSession, type SessionState } from "./legacySession";

const dataset: StudyDataset = {
  id: "pooled-eff-icgi",
  name: "Pooled efficacy analysis set",
  variables: [
    { id: "AUCss", name: "AUCss", label: "Steady-state AUC", role: "exposure", type: "continuous" },
    { id: "ICGI", name: "ICGI", label: "ICGI responder", role: "endpoint", type: "binary" }
  ],
  rowCount: 704,
  provenance: { source: "Pooled Phase II/III", generatedAt: "2026-07-01T00:00:00.000Z", checksum: "dataset-checksum-abc" }
};

const question: Question = {
  id: "q1",
  exposureMetricIds: ["AUCss"],
  endpointIds: ["ICGI"],
  stratificationVariableIds: [],
  covariateIds: [],
  filters: [],
  stratificationSplit: "tertile",
  ciMethod: "bootstrap",
  bootstrapConfig: { resamples: 300, seed: 12345, level: 0.95 }
};

const analysis: Analysis = {
  id: "a1",
  name: "AUC vs ICGI",
  question,
  model: { id: "spec1", modelFamily: "logistic" },
  visualizationConfig: {
    layout: "exposure-response-grid",
    showPoints: true,
    showFittedMarkers: true,
    showObservedMarkers: false,
    distributionMode: "boxplot"
  },
  createdAt: "2026-07-24T07:00:00.000Z",
  updatedAt: "2026-07-24T07:11:03.000Z"
};

const workspace: Workspace = {
  id: "ws1",
  dataset,
  analyses: [analysis],
  notes: [],
  exportHistory: [],
  metadata: {
    name: "Compound X Phase II ER analysis",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-24T07:15:00.000Z"
  }
};

describe("createSessionFile / serializeSessionFile / deserializeSessionFile", () => {
  it("round-trips a session through .erx text with a valid checksum and no migration", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi", activeAnalysisId: analysis.id });
    const text = serializeSessionFile(session);

    expect(session.erx).toBe(SESSION_FILE_KIND);
    expect(session.formatVersion).toBe(SESSION_FORMAT_VERSION);
    expect(isUuid(session.id)).toBe(true);
    expect(SESSION_FILE_EXTENSION).toBe(".erx");

    const result = deserializeSessionFile(text);
    expect(result.checksumValid).toBe(true);
    expect(result.migratedFrom).toBeUndefined();
    expect(result.session).toEqual(session);
  });

  it("defaults the dataset checksum onto reproducibility info from the workspace's dataset provenance", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    expect(session.reproducibility.datasetChecksum).toBe("dataset-checksum-abc");
  });

  it("rejects a payload that lacks the erx magic marker", () => {
    expect(() => deserializeSessionFile(JSON.stringify({ foo: "bar" }))).toThrow(SessionFileParseError);
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeSessionFile("{not json")).toThrow(SessionFileParseError);
  });

  it("rejects a session file claiming a format version newer than this build supports", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    const future = { ...session, formatVersion: SESSION_FORMAT_VERSION + 1 };
    expect(() => deserializeSessionFile(JSON.stringify(future))).toThrow(UnsupportedSessionVersionError);
  });

  it("flags checksumValid: false when the .erx content was tampered with after saving, without throwing", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    const tampered = { ...session, workspace: { ...session.workspace, id: "tampered-ws-id" } };
    const result = deserializeSessionFile(JSON.stringify(tampered));
    expect(result.checksumValid).toBe(false);
  });
});

describe("migrations", () => {
  beforeEach(() => {
    clearSessionMigrations();
  });

  it("migrates an unversioned (format version 0) file forward when a migration is registered", () => {
    registerSessionMigration(0, (data) => ({ ...data, formatVersion: 1, migratedNote: "upgraded-from-v0" }));
    const legacyLikeData: Record<string, unknown> = { someOldField: true };
    const migrated = migrateSessionData(legacyLikeData);
    expect(migrated.formatVersion).toBe(1);
    expect(migrated.migratedNote).toBe("upgraded-from-v0");
  });

  it("throws UnsupportedSessionVersionError when no migration is registered for an old version", () => {
    expect(() => migrateSessionData({ formatVersion: 0 })).toThrow(UnsupportedSessionVersionError);
  });

  it("surfaces migratedFrom on deserializeSessionFile when a real session was upgraded", () => {
    registerSessionMigration(0, (data) => ({ ...data, formatVersion: SESSION_FORMAT_VERSION }));
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    const unversioned: Record<string, unknown> = { ...session };
    delete unversioned.formatVersion;
    const result = deserializeSessionFile(JSON.stringify(unversioned));
    expect(result.migratedFrom).toBe(0);
    expect(result.session.formatVersion).toBe(SESSION_FORMAT_VERSION);
  });
});

describe("checksum", () => {
  it("is stable regardless of object key order", () => {
    const a = { x: 1, y: { b: 2, a: 1 } };
    const b = { y: { a: 1, b: 2 }, x: 1 };
    expect(computeChecksum(a)).toBe(computeChecksum(b));
  });

  it("canonicalize sorts object keys but preserves array order", () => {
    expect(canonicalize({ b: 1, a: [3, 2, 1] })).toEqual({ a: [3, 2, 1], b: 1 });
  });

  it("changes when content changes", () => {
    expect(computeChecksum({ a: 1 })).not.toBe(computeChecksum({ a: 2 }));
  });
});

describe("uuid", () => {
  it("generates syntactically valid, unique v4 UUIDs", () => {
    const a = createUuidV4();
    const b = createUuidV4();
    expect(isUuid(a)).toBe(true);
    expect(isUuid(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("operations (immutable mutation helpers)", () => {
  it("appendHistoryEntry adds an entry and recomputes the checksum", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    const updated = appendHistoryEntry(session, { actionKind: "update-model", description: "Switched to Emax" });

    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].description).toBe("Switched to Emax");
    expect(isUuid(updated.history[0].id)).toBe(true);
    expect(updated.checksum).not.toBe(session.checksum);
    expect(session.history).toHaveLength(0); // original untouched
    expect(deserializeSessionFile(serializeSessionFile(updated)).checksumValid).toBe(true);
  });

  it("setSelection stores a selection under a scope id and records history", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    const updated = setSelection(session, "panel-auc", { recordIds: ["s1", "s2"], source: "brush" });

    expect(updated.selections["panel-auc"].recordIds).toEqual(["s1", "s2"]);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].actionKind).toBe("update-selection");
    expect(deserializeSessionFile(serializeSessionFile(updated)).checksumValid).toBe(true);
  });

  it("setActiveAnalysis changes the active analysis and records history", () => {
    const session = createSessionFile({ workspace, savedBy: "smouksassi" });
    const updated = setActiveAnalysis(session, analysis.id);

    expect(updated.activeAnalysisId).toBe(analysis.id);
    expect(updated.history).toHaveLength(1);
    expect(deserializeSessionFile(serializeSessionFile(updated)).checksumValid).toBe(true);
  });
});

describe("legacy session API (unchanged, kept for apps/demo compatibility)", () => {
  it("still serializes and parses a SessionState round trip", () => {
    const state: SessionState = createSessionState(
      "dataset-1",
      { id: "m1", kind: "logistic", description: "test" },
      { id: "v1", model: { id: "m1", kind: "logistic", description: "test" }, data: { estimates: [], metadata: {} }, options: { title: "t", xAxisLabel: "x", yAxisLabel: "y", renderTarget: "svg" } },
      {},
      {},
      undefined
    );
    const text = serializeSession(state);
    const parsed = parseSession(text);
    expect(parsed.datasetId).toBe("dataset-1");
  });
});
