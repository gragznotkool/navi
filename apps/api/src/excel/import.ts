import ExcelJS from "exceljs";
import { z } from "zod";
import type { FieldDefinition, SiteConfiguration } from "@opshub/contracts";
import { AppError } from "../utils/errors.js";
import { INVENTORY_COLUMNS, visibleFields } from "./export.js";
import { restoreCell } from "./safe.js";

export const MAX_DATA_ROWS = 1000;
const MAX_COLUMNS = 30;
const MAX_CELL_CHARS = 1000;

export interface ParsedRow {
  /** 1-based spreadsheet row number. */
  row: number;
  sku: string;
  name?: string;
  unit?: string;
  onHand?: number;
  reorderLevel?: number;
  extras: Record<string, unknown>;
  errors: string[];
}

export interface ParsedSheet {
  fileErrors: string[];
  rows: ParsedRow[];
}

const rowSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, "SKU is required")
      .max(64, "SKU is too long (64 characters at most)")
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "SKU may contain letters, digits and . _ / - only"),
    name: z.string().trim().min(1, "Name cannot be empty").max(200, "Name is too long (200 characters at most)").optional(),
    unit: z.string().trim().min(1, "Unit cannot be empty").max(20, "Unit is too long (20 characters at most)").optional(),
    onHand: z.number("On hand must be a whole number").int("On hand must be a whole number").min(0, "On hand cannot be negative").max(1_000_000_000, "On hand is too large").optional(),
    reorderLevel: z.number("Reorder level must be a whole number").int("Reorder level must be a whole number").min(0, "Reorder level cannot be negative").max(1_000_000_000, "Reorder level is too large").optional(),
  })
  .strict();

type Raw = { ok: true; value: unknown } | { ok: false; message: string };

/** Reads one cell as plain data. A formula is refused, never evaluated or stored. */
function readCell(v: ExcelJS.CellValue): Raw {
  if (v === null || v === undefined) return { ok: true, value: undefined };
  if (typeof v === "string") {
    if (v.length > MAX_CELL_CHARS) return { ok: false, message: "text is too long" };
    const text = restoreCell(v).trim();
    return { ok: true, value: text === "" ? undefined : text };
  }
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return { ok: true, value: v };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return { ok: false, message: "formulas are not allowed; paste values instead" };
    if ("error" in v) return { ok: false, message: "contains an Excel error value" };
    if ("richText" in v) return readCell(v.richText.map((r) => r.text).join(""));
    if ("text" in v) return readCell(typeof v.text === "string" ? v.text : String(v.text));
  }
  return { ok: false, message: "has an unsupported value" };
}

const numberFrom = (v: unknown): unknown => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

function extraFrom(f: FieldDefinition, v: unknown): { value?: unknown; error?: string } {
  switch (f.type) {
    case "text":
      return typeof v === "string" ? { value: v } : { value: String(v) };
    case "number": {
      const n = numberFrom(v);
      return typeof n === "number" && Number.isFinite(n) ? { value: n } : { error: `${f.label} must be a number` };
    }
    case "boolean": {
      if (typeof v === "boolean") return { value: v };
      const t = typeof v === "string" ? v.toLowerCase() : "";
      if (["true", "yes", "y", "1"].includes(t)) return { value: true };
      if (["false", "no", "n", "0"].includes(t)) return { value: false };
      return { error: `${f.label} must be true or false` };
    }
    case "date": {
      if (v instanceof Date && !Number.isNaN(v.getTime())) return { value: v.toISOString().slice(0, 10) };
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return { value: v };
      return { error: `${f.label} must be a date (YYYY-MM-DD)` };
    }
  }
}

const invalid = (message: string) => new AppError(422, "invalid_spreadsheet", message);

/**
 * Turns an uploaded workbook into validated rows. Header whitelist (the standard columns plus this site's
 * visible inventory fields), row and column limits, per-row schema validation. Never touches the database.
 */
export async function parseInventorySheet(buffer: Buffer, config: SiteConfiguration): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw invalid("This file could not be read as an Excel (.xlsx) workbook.");
  }
  const sheet = wb.getWorksheet("Inventory") ?? wb.worksheets[0];
  if (!sheet) throw invalid("The workbook has no sheets.");

  const fields = visibleFields(config, "inventory_item");
  const known = new Map<string, { kind: "std"; key: string } | { kind: "field"; field: FieldDefinition }>();
  const stdKey: Record<string, string> = { sku: "sku", name: "name", unit: "unit", "on hand": "onHand", "reorder level": "reorderLevel" };
  for (const h of INVENTORY_COLUMNS) known.set(h.toLowerCase(), { kind: "std", key: stdKey[h.toLowerCase()]! });
  for (const f of fields) known.set(f.label.toLowerCase(), { kind: "field", field: f });

  const fileErrors: string[] = [];
  const header = sheet.getRow(1);
  const columns: { col: number; target: NonNullable<ReturnType<typeof known.get>> }[] = [];
  const seen = new Set<string>();
  const lastCol = Math.min(sheet.columnCount, MAX_COLUMNS + 1);
  if (sheet.columnCount > MAX_COLUMNS) fileErrors.push(`The sheet has more than ${MAX_COLUMNS} columns.`);
  for (let c = 1; c <= lastCol; c++) {
    const raw = readCell(header.getCell(c).value);
    if (!raw.ok) {
      fileErrors.push(`Header in column ${c} ${raw.message}.`);
      continue;
    }
    if (raw.value === undefined) continue;
    const label = String(raw.value).trim();
    const target = known.get(label.toLowerCase());
    if (!target) {
      fileErrors.push(`Column “${label.slice(0, 60)}” is not recognised. Allowed columns: ${[...INVENTORY_COLUMNS, ...fields.map((f) => f.label)].join(", ")}.`);
      continue;
    }
    if (seen.has(label.toLowerCase())) {
      fileErrors.push(`Column “${label}” appears more than once.`);
      continue;
    }
    seen.add(label.toLowerCase());
    columns.push({ col: c, target });
  }
  if (!seen.has("sku")) fileErrors.push("The SKU column is required.");

  if (sheet.actualRowCount - 1 > MAX_DATA_ROWS) fileErrors.push(`The sheet has more than ${MAX_DATA_ROWS} data rows. Split it into smaller files.`);
  if (fileErrors.length > 0) return { fileErrors, rows: [] };

  const rows: ParsedRow[] = [];
  const firstRowOfSku = new Map<string, number>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const xr = sheet.getRow(r);
    const std: Record<string, unknown> = {};
    const extras: Record<string, unknown> = {};
    const errors: string[] = [];
    let any = false;
    for (const { col, target } of columns) {
      const raw = readCell(xr.getCell(col).value);
      const label = target.kind === "std" ? String(header.getCell(col).value) : target.field.label;
      if (!raw.ok) {
        errors.push(`${label} ${raw.message}.`);
        any = true;
        continue;
      }
      if (raw.value === undefined) continue;
      any = true;
      if (target.kind === "std") std[target.key] = target.key === "onHand" || target.key === "reorderLevel" ? numberFrom(raw.value) : typeof raw.value === "string" ? raw.value : String(raw.value);
      else {
        const e = extraFrom(target.field, raw.value);
        if (e.error) errors.push(e.error);
        else extras[target.field.key] = e.value;
      }
    }
    if (!any) continue; // blank row

    const parsed = rowSchema.safeParse(std);
    if (!parsed.success) for (const i of parsed.error.issues) errors.push(i.message);
    const sku = typeof std.sku === "string" ? std.sku.trim() : "";
    if (sku && parsed.success) {
      const first = firstRowOfSku.get(sku);
      if (first !== undefined) errors.push(`SKU “${sku}” already appears on row ${first}.`);
      else firstRowOfSku.set(sku, r);
    }
    rows.push({ row: r, sku, ...(parsed.success ? stripUndefined(parsed.data) : {}), extras, errors });
  }
  return { fileErrors, rows };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
