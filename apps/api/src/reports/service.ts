import { eq } from "drizzle-orm";
import { z } from "zod";
import { type ImportResult, type ImportRowError, type ReportAccess, type ReportDefinition } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
import { AppError, forbidden, notFound } from "../utils/errors.js";
import { reportCatalog, isReportKey, type ColumnDef, type ReportKey } from "./catalog.js";
import { buildWorkbook, parseSheet, type RawCell } from "./excel.js";

export interface ReportActor {
  siteId: string;
  userId: string;
  roles: string[];
  requestId: string;
}
const scope = (a: ReportActor) => ({ siteId: a.siteId, userId: a.userId });

export class ImportRejected extends AppError {
  constructor(errors: ImportRowError[]) {
    const first = errors[0]!;
    super(
      422,
      "import_rejected",
      `Row ${first.row}: ${first.message}${errors.length > 1 ? ` (+${errors.length - 1} more error${errors.length > 2 ? "s" : ""})` : ""}. 0 rows written to database.`,
      errors.slice(0, 500).map((e) => ({ path: `row ${e.row}.${e.column}`, message: e.message, row: e.row, column: e.column })),
    );
  }
}

async function loadPolicy(db: Database, a: ReportActor, key: string): Promise<{ key: ReportKey; policy: ReportDefinition }> {
  const policy = await db.withTenant(scope(a), async (tx) => {
    const active = await getActiveRelease(tx, a.siteId);
    return active ? parseStoredConfig(active.configuration).reports[key] : undefined;
  });
  if (!policy || !isReportKey(key)) throw notFound("Report not found");
  return { key, policy };
}

/**
 * Additive RBAC: a column is hidden only when EVERY role that grants the user this action masks it.
 * (A user who also holds an unrestricted role keeps that role's visibility.)
 */
export function maskedFor(userRoles: readonly string[], allowedRoles: readonly string[], maskColumns: ReportDefinition["maskColumns"]): Set<string> {
  const relevant = userRoles.filter((r) => allowedRoles.includes(r));
  if (relevant.length === 0) return new Set();
  const [first, ...rest] = relevant.map((r) => new Set(maskColumns[r] ?? []));
  return new Set([...first!].filter((c) => rest.every((set) => set.has(c))));
}

const canDo = (roles: readonly string[], allowed: readonly string[]) => roles.some((r) => allowed.includes(r));

export async function listReports(db: Database, a: ReportActor): Promise<ReportAccess[]> {
  const reports = await db.withTenant(scope(a), async (tx) => {
    const active = await getActiveRelease(tx, a.siteId);
    return active ? parseStoredConfig(active.configuration).reports : {};
  });
  const out: ReportAccess[] = [];
  for (const [key, policy] of Object.entries(reports)) {
    if (!isReportKey(key)) continue;
    const source = reportCatalog[key];
    const canExport = canDo(a.roles, policy.exportRoles);
    const canImport = source.importable && canDo(a.roles, policy.importRoles);
    if (!canExport && !canImport) continue;
    const masked = maskedFor(a.roles, canExport ? policy.exportRoles : policy.importRoles, policy.maskColumns);
    out.push({
      key,
      title: policy.title,
      canExport,
      canImport,
      columns: source.columns.map((c) => ({ key: c.key, header: c.header, required: c.required && c.importable, masked: masked.has(c.key), importable: c.importable })),
    });
  }
  return out;
}

// ---------------------------------------------------------------- export

export async function exportReport(db: Database, a: ReportActor, key: string) {
  const { key: k, policy } = await loadPolicy(db, a, key);
  if (!canDo(a.roles, policy.exportRoles)) throw forbidden("Your role may not export this report");
  const masked = maskedFor(a.roles, policy.exportRoles, policy.maskColumns);

  const workbook = await db.withTenant(scope(a), async (tx) => {
    const rows = await tx.select().from(s.inventoryItems).where(eq(s.inventoryItems.siteId, a.siteId)).orderBy(s.inventoryItems.sku);
    const wb = buildWorkbook("Inventory", reportCatalog[k].columns, masked, rows);
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "report.exported", entityType: "report", entityId: k, metadata: { rows: rows.length, maskedColumns: [...masked] }, requestId: a.requestId });
    return wb;
  });
  return { workbook, fileName: `${k}-report.xlsx` };
}

// ---------------------------------------------------------------- import

type Item = (typeof reportCatalog.inventory.columns)[number];
type AnyCol = Omit<ColumnDef<unknown>, "value">;

const decimals2 = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

function cellSchema(c: AnyCol): z.ZodType<string | number> {
  const h = c.header;
  switch (c.kind) {
    case "int":
      return z.number({ error: `${h} must be a number` }).int(`${h} must be a whole number`).min(0, `${h} must be greater than or equal to 0`).max(1_000_000_000, `${h} is too large`);
    case "money":
      return z.number({ error: `${h} must be a number` }).min(0, `${h} must be greater than or equal to 0`).max(9_999_999_999, `${h} is too large`).refine(decimals2, `${h} may have at most 2 decimal places`);
    case "percent":
      return z.number({ error: `${h} must be a number` }).min(0, `${h} must be greater than or equal to 0`).max(100, `${h} must be less than or equal to 100`).refine(decimals2, `${h} may have at most 2 decimal places`);
    default:
      return z.string({ error: `${h} must be text` }).min(1, `${h} is required`).max(c.max ?? 200, `${h} must be at most ${c.max ?? 200} characters`);
  }
}

interface InventoryImportRow {
  rowNumber: number;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  reorderLevel: number;
  unitCost: number;
  vendorMargin: number;
}

function validateRows(cols: readonly Item[], rows: { rowNumber: number; cells: Map<string, RawCell> }[], masked: ReadonlySet<string>): { errors: ImportRowError[]; valid: InventoryImportRow[] } {
  const errors: ImportRowError[] = [];
  const valid: InventoryImportRow[] = [];
  const skuRow = new Map<string, number>();
  const importable = cols.filter((c) => c.importable);
  const schemas = new Map(importable.map((c) => [c.key, cellSchema(c)]));

  for (const row of rows) {
    const before = errors.length;
    const out: Record<string, string | number> = {};
    for (const c of importable) {
      const cell = row.cells.get(c.key) ?? { kind: "blank" as const };
      if (cell.kind === "blank") {
        if (c.required) errors.push({ row: row.rowNumber, column: c.header, message: `${c.header} is required` });
        continue;
      }
      if (masked.has(c.key)) {
        errors.push({ row: row.rowNumber, column: c.header, message: `${c.header} is restricted for your role and must be left blank` });
        continue;
      }
      if (cell.kind === "invalid") {
        errors.push({ row: row.rowNumber, column: c.header, message: `${c.header} ${cell.reason}` });
        continue;
      }
      const parsed = schemas.get(c.key)!.safeParse(cell.value);
      if (!parsed.success) errors.push({ row: row.rowNumber, column: c.header, message: parsed.error.issues[0]?.message ?? `${c.header} is invalid` });
      else out[c.key] = parsed.data;
    }
    if (typeof out.sku === "string") {
      const prior = skuRow.get(out.sku.toLowerCase());
      if (prior !== undefined) errors.push({ row: row.rowNumber, column: "SKU", message: `SKU "${out.sku}" duplicates row ${prior}` });
      else skuRow.set(out.sku.toLowerCase(), row.rowNumber);
    }
    if (errors.length === before) {
      valid.push({
        rowNumber: row.rowNumber,
        sku: out.sku as string,
        name: out.name as string,
        unit: (out.unit as string | undefined) ?? "each",
        onHand: out.onHand as number,
        reorderLevel: (out.reorderLevel as number | undefined) ?? 0,
        unitCost: (out.unitCost as number | undefined) ?? 0,
        vendorMargin: (out.vendorMargin as number | undefined) ?? 0,
      });
    }
  }
  return { errors, valid };
}

async function rejectionAudit(db: Database, a: ReportActor, key: string, fileName: string, errors: ImportRowError[], rowCount: number): Promise<void> {
  await db.withTenant(scope(a), (tx) =>
    recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "report.import_rejected", entityType: "report", entityId: key, metadata: { fileName, rowCount, errorCount: errors.length, firstError: errors[0] ?? null }, requestId: a.requestId }),
  );
}

/**
 * Zero tolerance: every row of the workbook is validated first; if ANY cell fails, nothing is
 * written. Otherwise all rows (items + opening-balance ledger entries + audit event) are inserted in
 * ONE transaction. `dryRun` performs everything except the writes (used by the upload preview).
 */
export async function importReport(db: Database, a: ReportActor, key: string, file: Buffer, fileName: string, dryRun: boolean): Promise<ImportResult> {
  const { key: k, policy } = await loadPolicy(db, a, key);
  if (k !== "inventory") throw new AppError(405, "import_unsupported", "This report is export-only");
  if (!canDo(a.roles, policy.importRoles)) throw forbidden("Your role may not import into this report");
  const masked = maskedFor(a.roles, policy.importRoles, policy.maskColumns);

  const sheet = await parseSheet(file, reportCatalog.inventory.columns);
  const cols = reportCatalog.inventory.columns;
  const { errors, valid } = validateRows(cols, sheet.rows, masked);
  const all = [...sheet.structureErrors, ...errors];
  if (sheet.rows.length === 0 && all.length === 0) all.push({ row: 2, column: "File", message: "Workbook contains no data rows" });

  if (all.length === 0) {
    const existing = await db.withTenant(scope(a), (tx) => tx.select({ sku: s.inventoryItems.sku }).from(s.inventoryItems).where(eq(s.inventoryItems.siteId, a.siteId)));
    const taken = new Set(existing.map((e) => e.sku.toLowerCase()));
    for (const r of valid) if (taken.has(r.sku.toLowerCase())) all.push({ row: r.rowNumber, column: "SKU", message: `SKU "${r.sku}" already exists in this site` });
  }
  if (all.length > 0) {
    await rejectionAudit(db, a, k, fileName, all, sheet.rows.length);
    throw new ImportRejected(all);
  }
  if (dryRun) return { fileName, rowCount: valid.length, dryRun: true, written: 0 };

  try {
    await db.withTenant(scope(a), async (tx: Tx) => {
      for (let i = 0; i < valid.length; i += 500) {
        const chunk = valid.slice(i, i + 500);
        const inserted = await tx
          .insert(s.inventoryItems)
          .values(chunk.map((r) => ({ siteId: a.siteId, sku: r.sku, name: r.name, unit: r.unit, onHand: r.onHand, reorderLevel: r.reorderLevel, unitCost: r.unitCost.toFixed(2), vendorMargin: r.vendorMargin.toFixed(2) })))
          .returning({ id: s.inventoryItems.id, onHand: s.inventoryItems.onHand });
        const ledger = inserted.filter((r) => r.onHand > 0).map((r) => ({ siteId: a.siteId, itemId: r.id, delta: r.onHand, balanceAfter: r.onHand, reason: "opening-balance" as const, refType: "import", refId: r.id, actorId: a.userId }));
        if (ledger.length > 0) await tx.insert(s.stockLedger).values(ledger);
      }
      await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "report.imported", entityType: "report", entityId: k, metadata: { fileName, rowCount: valid.length, uploadedBy: a.userId }, requestId: a.requestId });
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && "cause" in e && (e.cause as { code?: string } | undefined)?.code === "23505") {
      throw new AppError(409, "import_conflict", "A SKU was created concurrently. 0 rows written to database.");
    }
    throw e;
  }
  return { fileName, rowCount: valid.length, dryRun: false, written: valid.length };
}
