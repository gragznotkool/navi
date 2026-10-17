import type { inventoryItems } from "../db/schema/index.js";

/** Pure report metadata: shared by the config compiler (validation) and the export/import engines. */
export type ColumnKind = "text" | "int" | "money" | "percent";

export interface ColumnDef<Row> {
  key: string;
  header: string;
  kind: ColumnKind;
  required: boolean;
  /** false => export-only (calculated); never read on import. */
  importable: boolean;
  max?: number;
  width: number;
  value: (row: Row) => string | number;
}

export interface ReportSource<Row> {
  key: string;
  importable: boolean;
  columns: readonly ColumnDef<Row>[];
}

type ItemRow = typeof inventoryItems.$inferSelect;

const money = (v: string): number => Math.round(Number(v) * 100) / 100;

export const inventoryReport: ReportSource<ItemRow> = {
  key: "inventory",
  importable: true,
  columns: [
    { key: "sku", header: "SKU", kind: "text", required: true, importable: true, max: 64, width: 18, value: (r) => r.sku },
    { key: "name", header: "Item Name", kind: "text", required: true, importable: true, max: 200, width: 34, value: (r) => r.name },
    { key: "unit", header: "Unit", kind: "text", required: false, importable: true, max: 20, width: 10, value: (r) => r.unit },
    { key: "onHand", header: "Quantity", kind: "int", required: true, importable: true, width: 12, value: (r) => r.onHand },
    { key: "reorderLevel", header: "Reorder Level", kind: "int", required: false, importable: true, width: 14, value: (r) => r.reorderLevel },
    { key: "unitCost", header: "Unit Cost ($)", kind: "money", required: false, importable: true, width: 14, value: (r) => money(r.unitCost) },
    { key: "vendorMargin", header: "Margin (%)", kind: "percent", required: false, importable: true, width: 12, value: (r) => money(r.vendorMargin) },
    { key: "totalValue", header: "Total Value ($)", kind: "money", required: false, importable: false, width: 16, value: (r) => Math.round(r.onHand * money(r.unitCost) * 100) / 100 },
  ],
};

export const reportCatalog = { inventory: inventoryReport } as const;
export type ReportKey = keyof typeof reportCatalog;
export const isReportKey = (k: string): k is ReportKey => Object.hasOwn(reportCatalog, k);
export const columnKeys = (k: ReportKey): string[] => reportCatalog[k].columns.map((c) => c.key);
