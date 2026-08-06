/** Analyst-facing column role in the demo mapping UI (maps to `@er-explorer/domain` roles via hints). */
export type DemoColumnRole = "ignore" | "identifier" | "dose" | "exposure" | "endpoint" | "covariate";

export const DEMO_COLUMN_ROLES: DemoColumnRole[] = ["ignore", "identifier", "dose", "exposure", "endpoint", "covariate"];

export function roleHintForDemoRole(role: DemoColumnRole): import("@er-explorer/data").VariableRoleHint | undefined {
  switch (role) {
    case "identifier":
      return { role: "identifier" };
    case "exposure":
      return { role: "exposure" };
    case "endpoint":
      return { role: "endpoint" };
    case "covariate":
      return { role: "covariate" };
    case "dose":
      return { role: "stratification", label: "Dose" };
    case "ignore":
    default:
      return undefined;
  }
}

/** Default roles for bundled icgi / effICGI CSV (`data.generated.ts` column names). */
export const EFFICGI_DEFAULT_ROLES: Record<string, DemoColumnRole> = {
  id: "identifier",
  study: "covariate",
  dose: "dose",
  doseNumeric: "ignore",
  sex: "covariate",
  age: "covariate",
  wt: "covariate",
  race: "covariate",
  crcl: "covariate",
  gbds: "ignore",
  auc: "exposure",
  cmax: "exposure",
  icgi: "endpoint",
  icgi7: "endpoint",
  icgi2: "endpoint",
  icgi3: "endpoint",
  brls: "endpoint",
  prls: "endpoint"
};

export function normalizeColumnKey(columnId: string): string {
  return columnId.toLowerCase().replace(/[\s._-]+/g, "");
}

/**
 * Heuristic: column name suggests drug PK exposure (reference arm expected ~0 on x),
 * as opposed to baseline covariates (wt, age) used as x for exploration.
 * Matches common labels (AUC, Cmax, Cmin, CAVE/Cavg, Css, trough, …) plus substring variants (AUCtau, c_max).
 */
export function looksLikePkExposureColumn(columnId: string): boolean {
  const n = normalizeColumnKey(columnId);
  if (!n) return false;

  const exact = new Set([
    "auc",
    "aumc",
    "cmax",
    "cmin",
    "cavg",
    "cave",
    "css",
    "ctrough",
    "cav",
    "cminss",
    "cmaxss",
    "cavss",
    "cavgss",
    "auctau",
    "aucinf",
    "auc0inf",
    "aucss",
    "auclast",
    "aucpt",
    "cmaxpp",
    "cminpp",
    "cmaxmd",
    "cminmd",
    "cpk",
    "cpeak",
    "ctroughconc"
  ]);
  if (exact.has(n)) return true;

  const needles = ["auc", "aumc", "cmax", "cmin", "cavg", "cave", "css", "ctrough", "troughc", "conc"];
  if (needles.some((s) => n.includes(s))) return true;

  if (/^c(max|min|avg|ave|ss|tau|trough|pk|inf|0)/.test(n)) return true;
  if (/^(max|min|avg|ave|ss|trough|peak|c)max$/.test(n)) return true;
  if (/^(max|min|avg|ave|ss|trough)c$/.test(n)) return true;

  return false;
}

export function guessColumnRole(columnId: string, distinctCount: number): DemoColumnRole {
  const lower = columnId.toLowerCase();
  if (lower === "id" || lower.endsWith("_id") || lower === "usubjid" || lower === "subject") return "identifier";
  if (lower.includes("dose")) return "dose";
  if (looksLikePkExposureColumn(columnId)) return "exposure";
  if (lower.startsWith("icgi") || lower === "brls" || lower === "prls") return "endpoint";
  if (lower === "sex" || lower === "age" || lower === "wt" || lower === "weight" || lower === "race" || lower === "crcl") {
    return "covariate";
  }
  if (distinctCount === 2 && (lower.includes("resp") || lower.startsWith("icgi"))) return "endpoint";
  if (lower.includes("endpoint") || lower === "y") return "endpoint";
  return "ignore";
}

export interface MappingValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateColumnMapping(roles: Record<string, DemoColumnRole>): MappingValidationResult {
  const errors: string[] = [];
  const counts: Record<DemoColumnRole, number> = {
    ignore: 0,
    identifier: 0,
    dose: 0,
    exposure: 0,
    endpoint: 0,
    covariate: 0
  };
  for (const role of Object.values(roles)) counts[role]++;

  if (counts.identifier < 1) errors.push("Map exactly one identifier column (subject id).");
  if (counts.dose < 1) errors.push("Map one dose column (or use a single-level dose for all rows).");
  if (counts.exposure < 1) errors.push("Map at least one exposure column.");
  if (counts.endpoint < 1) errors.push("Map at least one endpoint column.");

  return { ok: errors.length === 0, errors };
}
