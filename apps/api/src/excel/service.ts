import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ImportReport, ImportRowReport, RequestRecord, SiteConfiguration, StockItem } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { validateExtras } from "../fields/runtime.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
import * as ops from "../services/operations.js";
import { AppError, conflict } from "../utils/errors.js";
import { inventoryTemplate, inventoryWorkbook, requestsWorkbook, visibleFields } from "./export.js";
import { parseInventorySheet, type ParsedRow } from "./import.js";
import { assertSafeXlsx } from "./zipGuard.js";

const EXPORT_PAGE = 500;
const EXPORT_MAX_ROWS = 20_000;

type Actor = ops.Actor;
const scope = (a: Actor) => ({ siteId: a.siteId, userId: a.userId });

async function loadConfig(db: Database, a: Actor): Promise<{ config: SiteConfiguration; version: number }> {
  return db.withTenant(scope(a), async (tx) => {
    const active = await getActiveRelease(tx, a.siteId);
    if (!active) throw new AppError(404, "no_active_release", "Site has no active configuration release");
    return { config: parseStoredConfig(active.configuration), version: active.version };
  });
}

// ---------------------------------------------------------------------------------------------- export

/** Reads every page of a listing (bounded), always through the caller's own site scope. */
async function allPages<T>(read: (page: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < EXPORT_MAX_ROWS; page++) {
    const batch = await read(page);
    out.push(...batch.items);
    if (batch.items.length === 0 || out.length >= batch.total) break;
  }
  return out;
}

export async function exportInventory(db: Database, a: Actor): Promise<Buffer> {
  const { config } = await loadConfig(db, a);
  const items: StockItem[] = await allPages((p) => ops.listItems(db, a, p, EXPORT_PAGE));
  return inventoryWorkbook(config, items);
}

export async function exportRequests(db: Database, a: Actor): Promise<Buffer> {
  const { config } = await loadConfig(db, a);
  const requests: RequestRecord[] = await allPages((p) => ops.listRequests(db, a, p, EXPORT_PAGE));
  return requestsWorkbook(config, requests);
}

export async function importTemplate(db: Database, a: Actor): Promise<Buffer> {
  return inventoryTemplate((await loadConfig(db, a)).config);
}

// ---------------------------------------------------------------------------------------------- import

type Existing = typeof s.inventoryItems.$inferSelect;

interface PlannedRow {
  parsed: ParsedRow;
  report: ImportRowReport;
  existing?: Existing;
  /** Fields that will be written for an update, or the full record for a create. */
  next?: { name: string; unit: string; onHand: number; reorderLevel: number; extras: Record<string, unknown> };
  stockDelta: number;
}

const quote = (v: unknown): string => (typeof v === "string" ? `“${v}”` : String(v));

/** Compares the parsed rows with what is stored. With `lock`, the existing rows are locked in a fixed order first. */
async function plan(tx: Tx, a: Actor, config: SiteConfiguration, rows: ParsedRow[], lock: boolean): Promise<PlannedRow[]> {
  const skus = rows.filter((r) => r.errors.length === 0).map((r) => r.sku);
  let q = tx
    .select()
    .from(s.inventoryItems)
    .where(and(eq(s.inventoryItems.siteId, a.siteId), inArray(s.inventoryItems.sku, skus.length ? skus : [""])))
    .orderBy(asc(s.inventoryItems.sku))
    .$dynamic();
  if (lock) q = q.for("update");
  const existing = new Map((await q).map((e) => [e.sku, e]));
  const labels = new Map(visibleFields(config, "inventory_item").map((f) => [f.key, f.label]));

  return rows.map((p): PlannedRow => {
    const report: ImportRowReport = { row: p.row, sku: p.sku, action: "error", changes: [], errors: [...p.errors] };
    if (report.errors.length > 0) return { parsed: p, report, stockDelta: 0 };
    // Extras are validated against the ACTIVE configuration by the same code path as the inventory editor.
    try {
      validateExtras(config, "inventory_item", p.extras, { requireAll: false });
    } catch (e) {
      if (e instanceof AppError) report.errors.push(...(e.details ?? [{ message: e.message }]).map((d) => d.message));
      else throw e;
      return { parsed: p, report, stockDelta: 0 };
    }

    const cur = existing.get(p.sku);
    if (!cur) {
      if (p.name === undefined) {
        report.errors.push("Name is required for a new item.");
        return { parsed: p, report, stockDelta: 0 };
      }
      const next = { name: p.name, unit: p.unit ?? "each", onHand: p.onHand ?? 0, reorderLevel: p.reorderLevel ?? 0, extras: p.extras };
      report.action = "create";
      report.changes.push(`New item “${next.name}”${next.onHand > 0 ? ` with ${next.onHand} ${next.unit} in stock` : ""}.`);
      return { parsed: p, report, next, stockDelta: next.onHand };
    }

    const storedExtras = (cur.extras ?? {}) as Record<string, unknown>;
    const next = { name: p.name ?? cur.name, unit: p.unit ?? cur.unit, onHand: p.onHand ?? cur.onHand, reorderLevel: p.reorderLevel ?? cur.reorderLevel, extras: { ...storedExtras, ...p.extras } };
    if (next.name !== cur.name) report.changes.push(`Name: ${quote(cur.name)} to ${quote(next.name)}`);
    if (next.unit !== cur.unit) report.changes.push(`Unit: ${quote(cur.unit)} to ${quote(next.unit)}`);
    if (next.reorderLevel !== cur.reorderLevel) report.changes.push(`Reorder level: ${cur.reorderLevel} to ${next.reorderLevel}`);
    const delta = next.onHand - cur.onHand;
    if (delta !== 0) report.changes.push(`On hand: ${cur.onHand} to ${next.onHand} (${delta > 0 ? "+" : ""}${delta}, recorded in the stock ledger)`);
    for (const [key, value] of Object.entries(p.extras)) {
      if (JSON.stringify(storedExtras[key]) !== JSON.stringify(value)) report.changes.push(`${labels.get(key) ?? key}: ${storedExtras[key] === undefined ? "(empty)" : quote(storedExtras[key])} to ${quote(value)}`);
    }
    report.action = report.changes.length > 0 ? "update" : "unchanged";
    return { parsed: p, report, existing: cur, next, stockDelta: delta };
  });
}

function summarize(planned: PlannedRow[], fileErrors: string[], flags: { dryRun: boolean; applied: boolean; replayed: boolean }): ImportReport {
  const rows = planned.map((p) => p.report);
  const count = (action: ImportRowReport["action"]) => rows.filter((r) => r.action === action).length;
  return {
    ...flags,
    totals: { rows: rows.length, create: count("create"), update: count("update"), unchanged: count("unchanged"), errors: count("error"), stockChanges: planned.filter((p) => p.report.action !== "error" && p.stockDelta !== 0).length },
    fileErrors,
    rows,
  };
}

const fileReport = (fileErrors: string[], dryRun: boolean): ImportReport => summarize([], fileErrors, { dryRun, applied: false, replayed: false });

export interface ImportOptions {
  dryRun: boolean;
  /** Required when applying. */
  idempotencyKey?: string | undefined;
}

/**
 * Imports inventory from a workbook. Dry run reports exactly what would happen and writes nothing. Applying is
 * all-or-nothing: if ANY row is invalid nothing is written. One transaction, stock quantity changes recorded in
 * the ledger, and the same Idempotency-Key can never apply the same file twice.
 */
export async function importInventory(db: Database, a: Actor, file: Buffer, opts: ImportOptions): Promise<ImportReport> {
  assertSafeXlsx(file);
  const { config, version } = await loadConfig(db, a);
  const sheet = await parseInventorySheet(file, config);
  if (sheet.fileErrors.length > 0) return fileReport(sheet.fileErrors, opts.dryRun);

  if (opts.dryRun) {
    return db.withTenant(scope(a), async (tx) => summarize(await plan(tx, a, config, sheet.rows, false), [], { dryRun: true, applied: false, replayed: false }));
  }

  const hash = createHash("sha256").update(file).digest("hex");
  try {
    return await db.withTenant(scope(a), async (tx) => {
      const planned = await plan(tx, a, config, sheet.rows, true);
      const base = summarize(planned, [], { dryRun: false, applied: false, replayed: false });
      if (base.totals.errors > 0) return base; // nothing is written, and the key is not consumed

      const { value, replayed } = await ops.idempotent(tx, a, opts.idempotencyKey!, "inventory.import", { fileSha256: hash }, async () => {
        for (const p of [...planned].sort((x, y) => x.parsed.sku.localeCompare(y.parsed.sku))) {
          if (!p.next || p.report.action === "unchanged" || p.report.action === "error") continue;
          let itemId = p.existing?.id;
          if (p.report.action === "create") {
            const [row] = await tx.insert(s.inventoryItems).values({ siteId: a.siteId, sku: p.parsed.sku, name: p.next.name, unit: p.next.unit, onHand: p.next.onHand, reorderLevel: p.next.reorderLevel, extras: p.next.extras }).returning();
            itemId = row!.id;
          } else {
            await tx
              .update(s.inventoryItems)
              .set({ name: p.next.name, unit: p.next.unit, onHand: p.next.onHand, reorderLevel: p.next.reorderLevel, extras: p.next.extras, updatedAt: new Date() })
              .where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, itemId!)));
          }
          if (p.stockDelta !== 0) {
            await tx.insert(s.stockLedger).values({
              siteId: a.siteId,
              itemId: itemId!,
              delta: p.stockDelta,
              balanceAfter: p.next.onHand,
              reason: p.report.action === "create" ? "opening-balance" : "adjustment",
              refType: "import",
              actorId: a.userId,
              configVersion: version,
            });
          }
        }
        await recordAudit(tx, {
          siteId: a.siteId,
          actorId: a.userId,
          action: "inventory.import",
          entityType: "inventory",
          requestId: a.requestId,
          configVersion: version,
          metadata: { fileSha256: hash, ...base.totals },
        });
        return { ...base, applied: true } satisfies ImportReport;
      });
      return { ...value, replayed };
    });
  } catch (e) {
    // Two imports created the same new SKU at the same moment: the loser rolled back cleanly.
    if (isUniqueViolation(e)) throw conflict("import_conflict", "Another change touched the same items at the same moment. Nothing was imported; try again.");
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
