import ExcelJS from "exceljs";
import type { FieldDefinition, RequestRecord, SiteConfiguration, StockItem } from "@opshub/contracts";
import { neutralizeCell } from "./safe.js";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const visibleFields = (config: SiteConfiguration, entity: FieldDefinition["entity"]): FieldDefinition[] => config.fields.filter((f) => f.entity === entity && !f.hidden);

/** Headers the inventory sheet uses, in order. Import accepts exactly these (plus the site's visible field labels). */
export const INVENTORY_COLUMNS = ["SKU", "Name", "Unit", "On hand", "Reorder level"] as const;

const cell = (v: unknown): ExcelJS.CellValue => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return neutralizeCell(v);
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  return neutralizeCell(String(v));
};

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((c) => (c.width = Math.max(12, Math.min(40, String(c.header ?? "").length + 4))));
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function newWorkbook(config: SiteConfiguration): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OpsHub";
  wb.title = `${config.name} export`;
  wb.created = new Date();
  return wb;
}

export async function inventoryWorkbook(config: SiteConfiguration, items: StockItem[]): Promise<Buffer> {
  const wb = newWorkbook(config);
  const sheet = wb.addWorksheet("Inventory");
  const fields = visibleFields(config, "inventory_item");
  sheet.columns = [...INVENTORY_COLUMNS, ...fields.map((f) => f.label)].map((h) => ({ header: neutralizeCell(h) as string, key: h }));
  for (const i of items) {
    const values: ExcelJS.CellValue[] = [cell(i.sku), cell(i.name), cell(i.unit), i.onHand, i.reorderLevel, ...fields.map((f) => cell(i.extras[f.key]))];
    sheet.addRow(values);
  }
  styleHeader(sheet);
  return toBuffer(wb);
}

/** One row per request line, so every line can be filtered and summed in Excel. */
export async function requestsWorkbook(config: SiteConfiguration, requests: RequestRecord[]): Promise<Buffer> {
  const wb = newWorkbook(config);
  const sheet = wb.addWorksheet("Requests");
  const fields = visibleFields(config, "request_line");
  const head = ["Request", "Status", "Created", "Status changed", "Config version", "SKU", "Item", "Quantity", ...fields.map((f) => f.label)];
  sheet.columns = head.map((h) => ({ header: neutralizeCell(h) as string, key: h }));
  for (const r of requests) {
    for (const l of r.lines) {
      sheet.addRow([cell(r.id), cell(r.status), new Date(r.createdAt), new Date(r.statusChangedAt), r.releaseVersion, cell(l.sku), cell(l.name), l.quantity, ...fields.map((f) => cell(l.extras[f.key]))]);
    }
  }
  sheet.getColumn(3).numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn(4).numFmt = "yyyy-mm-dd hh:mm";
  styleHeader(sheet);
  return toBuffer(wb);
}

/** A starter file for imports: the exact headers, one example row. */
export async function inventoryTemplate(config: SiteConfiguration): Promise<Buffer> {
  return inventoryWorkbook(config, []);
}
