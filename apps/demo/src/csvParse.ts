import type { RawCellValue } from "@er-explorer/data";

/**
 * Minimal RFC4180-style CSV parser for client-side uploads (no dependencies).
 * Handles quoted fields and doubled quotes inside quotes.
 */
export function parseCsv(text: string): Array<Record<string, RawCellValue>> {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuotes) {
      if (ch === '"') {
        if (trimmed[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && trimmed[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);

  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  const out: Array<Record<string, RawCellValue>> = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const record: Record<string, RawCellValue> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      record[key] = coerceCell(cells[c] ?? "");
    }
    out.push(record);
  }
  return out;
}

function coerceCell(raw: string): RawCellValue {
  const s = raw.trim();
  if (s === "") return null;
  if (s === "NA" || s === "NaN" || s === ".") return null;
  const n = Number(s);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return n;
  if (s === "TRUE" || s === "true") return true;
  if (s === "FALSE" || s === "false") return false;
  return s;
}
