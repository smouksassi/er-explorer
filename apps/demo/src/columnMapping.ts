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

/** Default roles for bundled effICGI (`data.generated.ts` column names). */
export const EFFICGI_DEFAULT_ROLES: Record<string, DemoColumnRole> = {
  id: "identifier",
  study: "covariate",
  dose: "dose",
  doseNumeric: "ignore",
  auc: "exposure",
  cmax: "exposure",
  icgi: "endpoint",
  icgi2: "endpoint",
  icgi3: "endpoint",
  brls: "endpoint",
  prls: "endpoint"
};

export function guessColumnRole(columnId: string, distinctCount: number): DemoColumnRole {
  const lower = columnId.toLowerCase();
  if (lower === "id" || lower.endsWith("_id") || lower === "usubjid" || lower === "subject") return "identifier";
  if (lower.includes("dose")) return "dose";
  if (lower === "auc" || lower === "cmax" || lower.includes("auc") || lower.includes("cmax")) return "exposure";
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
