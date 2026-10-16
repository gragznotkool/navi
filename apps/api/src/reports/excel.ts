import ExcelJS from "exceljs";
import { MASKED_CELL, REPORT_MAX_ROWS, type ImportRowError } from "@opshub/contracts";
import { AppError } from "../utils/errors.js";
import type { ColumnDef } from "./catalog.js";

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Neutralises spreadsheet formula injection: text that Excel would execute is prefixed with a single quote. */
export function sanitizeCell(value: string): string {
  return value.length > 0 && FORMULA_TRIGGERS.has(value[0]!) ? `'${value}` : value;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Builds a workbook. `masked` columns are replaced by MASKED_CELL for every row. */
export function buildWorkbook<Row>(sheetName: string, columns: readonly ColumnDef<Row>[], masked: ReadonlySet<string>, rows: readonly Row[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OpsHub";
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of rows) {
    const cells: Record<string, string | number> = {};
    for (const c of columns) {
      const v = masked.has(c.key) ? MASKED_CELL : c.value(row);
      cells[c.key] = typeof v === "string" ? sanitizeCell(v) : v;
    }
    ws.addRow(cells);
  }
  columns.forEach((c, i) => {
    if (c.kind === "money") ws.getColumn(i + 1).numFmt = "#,##0.00";
  });
  return wb;
}

// ---------------------------------------------------------------- import parsing

const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;

/** Rejects non-xlsx input and zip bombs BEFORE handing the buffer to the (in-memory) xlsx parser. */
export function assertSafeXlsx(buf: Buffer): void {
  const bad = (m: string) => new AppError(422, "invalid_workbook", m);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw bad("File is not a valid .xlsx workbook");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("File is not a valid .xlsx workbook");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES || entries === 0xffff || p === 0xffffffff) throw bad("Workbook structure is not supported");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad("File is not a valid .xlsx workbook");
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff) throw bad("Workbook structure is not supported");
    total += size;
    if (total > MAX_UNCOMPRESSED_BYTES) throw bad("Workbook expands to an unreasonable size");
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}

export type RawCell = { kind: "blank" } | { kind: "number"; value: number } | { kind: "text"; value: string } | { kind: "invalid"; reason: string };

function readCell(v: ExcelJS.CellValue): RawCell {
  if (v === null || v === undefined) return { kind: "blank" };
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "number", value: v } : { kind: "invalid", reason: "is not a finite number" };
  if (typeof v === "string") return v.trim() === "" ? { kind: "blank" } : { kind: "text", value: v.trim() };
  if (typeof v === "boolean") return { kind: "invalid", reason: "must not be a TRUE/FALSE value" };
  if (v instanceof Date) return { kind: "invalid", reason: "must not be a date" };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return { kind: "invalid", reason: "must not contain a formula (paste values only)" };
    if ("error" in v) return { kind: "invalid", reason: "contains a spreadsheet error value" };
    if ("richText" in v) {
      const t = v.richText.map((r) => r.text).join("").trim();
      return t === "" ? { kind: "blank" } : { kind: "text", value: t };
    }
    if ("text" in v) return { kind: "text", value: String(v.text).trim() };
  }
  return { kind: "invalid", reason: "has an unsupported value" };
}

export interface ParsedSheet {
  rows: { rowNumber: number; cells: Map<string, RawCell> }[];
  structureErrors: ImportRowError[];
}

export async function parseSheet<Row>(buf: Buffer, columns: readonly ColumnDef<Row>[]): Promise<ParsedSheet> {
  assertSafeXlsx(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new AppError(422, "invalid_workbook", "File could not be read as an .xlsx workbook");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError(422, "invalid_workbook", "Workbook has no worksheets");
  if (ws.rowCount > REPORT_MAX_ROWS + 1) {
    throw new AppError(422, "too_many_rows", `Import is limited to ${REPORT_MAX_ROWS} data rows (sheet has ${ws.rowCount - 1}). 0 rows written to database.`);
  }

  const structureErrors: ImportRowError[] = [];
  const byHeader = new Map<string, ColumnDef<Row>>();
  for (const c of columns.filter((x) => x.importable)) {
    byHeader.set(c.header.toLowerCase(), c);
    byHeader.set(c.key.toLowerCase(), c);
  }
  const colIndex = new Map<number, string>();
  const seen = new Set<string>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, idx) => {
    const raw = readCell(cell.value);
    const text = raw.kind === "text" ? raw.value : raw.kind === "number" ? String(raw.value) : "";
    const def = byHeader.get(text.toLowerCase());
    if (!def) structureErrors.push({ row: 1, column: text || `Column ${idx}`, message: `Unknown column "${text}"` });
    else if (seen.has(def.key)) structureErrors.push({ row: 1, column: def.header, message: "Column appears more than once" });
    else {
      seen.add(def.key);
      colIndex.set(idx, def.key);
    }
  });
  for (const c of columns.filter((x) => x.importable && x.required && !seen.has(x.key))) {
    structureErrors.push({ row: 1, column: c.header, message: `Required column "${c.header}" is missing` });
  }

  const rows: ParsedSheet["rows"] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = new Map<string, RawCell>();
    let any = false;
    for (const [idx, key] of colIndex) {
      const cell = readCell(row.getCell(idx).value);
      if (cell.kind !== "blank") any = true;
      cells.set(key, cell);
    }
    if (any) rows.push({ rowNumber: r, cells });
  }
  return { rows, structureErrors };
}
