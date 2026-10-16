import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type {
  Assignment,
  ConsumptionRecord,
  HubOverviewResponse,
  PaginatedResponse,
  RepairRecord,
  RepairStatus,
  RequestRecord,
  ReturnRecord,
  ReturnStatus,
  StockItem,
  StockSummary,
} from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease } from "../repositories/releases.js";
import { canTransition, repairTransitions, requestTransitions, returnTransitions } from "../workflows/transitions.js";
import { AppError, conflict, notFound } from "../utils/errors.js";

export interface Actor {
  siteId: string;
  userId: string;
  requestId: string;
}
const scope = (a: Actor) => ({ siteId: a.siteId, userId: a.userId });

export class InsufficientStock extends AppError {
  constructor(available: number, requested: number) {
    super(409, "insufficient_stock", `Insufficient stock: ${available} available, ${requested} requested`);
  }
}

const toStockItem = (r: typeof s.inventoryItems.$inferSelect): StockItem => ({
  id: r.id,
  siteId: r.siteId,
  sku: r.sku,
  name: r.name,
  unit: r.unit,
  onHand: r.onHand,
  reorderLevel: r.reorderLevel,
  updatedAt: r.updatedAt.toISOString(),
});
const toRequest = (r: typeof s.requests.$inferSelect): RequestRecord => ({
  id: r.id,
  siteId: r.siteId,
  itemId: r.itemId,
  quantity: r.quantity,
  status: r.status,
  requestedBy: r.requestedBy,
  releaseVersion: r.releaseVersion,
  createdAt: r.createdAt.toISOString(),
});
const toAssignment = (r: typeof s.assignments.$inferSelect): Assignment => ({
  id: r.id,
  siteId: r.siteId,
  requestId: r.requestId,
  itemId: r.itemId,
  quantity: r.quantity,
  assignedBy: r.assignedBy,
  createdAt: r.createdAt.toISOString(),
});
const toConsumption = (r: typeof s.consumptionRecords.$inferSelect): ConsumptionRecord => ({
  id: r.id,
  siteId: r.siteId,
  assignmentId: r.assignmentId,
  quantity: r.quantity,
  recordedBy: r.recordedBy,
  createdAt: r.createdAt.toISOString(),
});
const toReturn = (r: typeof s.returnRecords.$inferSelect): ReturnRecord => ({
  id: r.id,
  siteId: r.siteId,
  assignmentId: r.assignmentId,
  quantity: r.quantity,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});
const toRepair = (r: typeof s.repairRecords.$inferSelect): RepairRecord => ({
  id: r.id,
  siteId: r.siteId,
  boardSerial: r.boardSerial,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});

// ---------------------------------------------------------------- reads

export async function listItems(db: Database, a: Actor, page: number, pageSize: number): Promise<PaginatedResponse<StockItem>> {
  return db.withTenant(scope(a), async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(s.inventoryItems).where(eq(s.inventoryItems.siteId, a.siteId));
    const rows = await tx.select().from(s.inventoryItems).where(eq(s.inventoryItems.siteId, a.siteId)).orderBy(s.inventoryItems.sku).limit(pageSize).offset((page - 1) * pageSize);
    return { items: rows.map(toStockItem), page, pageSize, total };
  });
}

export async function getItem(db: Database, a: Actor, itemId: string) {
  return db.withTenant(scope(a), async (tx) => {
    const [row] = await tx.select().from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, itemId)));
    if (!row) throw notFound("Item not found");
    const ledger = await tx.select().from(s.stockLedger).where(eq(s.stockLedger.itemId, itemId)).orderBy(desc(s.stockLedger.createdAt)).limit(50);
    return {
      item: toStockItem(row),
      ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, balanceAfter: l.balanceAfter, reason: l.reason, refType: l.refType, refId: l.refId, createdAt: l.createdAt.toISOString() })),
    };
  });
}

export async function listRequests(db: Database, a: Actor, page: number, pageSize: number): Promise<PaginatedResponse<RequestRecord>> {
  return db.withTenant(scope(a), async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(s.requests).where(eq(s.requests.siteId, a.siteId));
    const rows = await tx.select().from(s.requests).where(eq(s.requests.siteId, a.siteId)).orderBy(desc(s.requests.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return { items: rows.map(toRequest), page, pageSize, total };
  });
}

export async function getRequest(db: Database, a: Actor, id: string): Promise<RequestRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [row] = await tx.select().from(s.requests).where(and(eq(s.requests.siteId, a.siteId), eq(s.requests.id, id)));
    if (!row) throw notFound("Request not found");
    return toRequest(row);
  });
}

export async function listAssignments(db: Database, a: Actor): Promise<Assignment[]> {
  return db.withTenant(scope(a), async (tx) => (await tx.select().from(s.assignments).where(eq(s.assignments.siteId, a.siteId)).orderBy(desc(s.assignments.createdAt)).limit(100)).map(toAssignment));
}

// ---------------------------------------------------------------- writes

export async function createRequest(db: Database, a: Actor, input: { itemId: string; quantity: number; note?: string | undefined }): Promise<RequestRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [item] = await tx.select({ id: s.inventoryItems.id }).from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, input.itemId)));
    if (!item) throw notFound("Item not found");
    const active = await getActiveRelease(tx, a.siteId);
    if (!active) throw conflict("no_active_release", "Site has no active configuration release");
    const [row] = await tx
      .insert(s.requests)
      .values({ siteId: a.siteId, itemId: input.itemId, quantity: input.quantity, status: "submitted", requestedBy: a.userId, releaseVersion: active.version, note: input.note ?? null })
      .returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "request.submitted", entityType: "request", entityId: row!.id, requestId: a.requestId });
    return toRequest(row!);
  });
}

async function lockRequest(tx: Tx, siteId: string, id: string) {
  const [row] = await tx.select().from(s.requests).where(and(eq(s.requests.siteId, siteId), eq(s.requests.id, id))).for("update");
  if (!row) throw notFound("Request not found");
  return row;
}

export async function decideRequest(db: Database, a: Actor, requestId: string, decision: "approved" | "rejected", comment?: string): Promise<RequestRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const req = await lockRequest(tx, a.siteId, requestId);
    if (!canTransition(requestTransitions, req.status, decision)) {
      throw conflict("invalid_transition", `A request in status "${req.status}" cannot become "${decision}"`);
    }
    await tx.insert(s.approvals).values({ siteId: a.siteId, requestId, decision, decidedBy: a.userId, comment: comment ?? null });
    const [updated] = await tx.update(s.requests).set({ status: decision, updatedAt: new Date() }).where(and(eq(s.requests.id, requestId), eq(s.requests.status, "submitted"))).returning();
    if (!updated) throw conflict("invalid_transition", "Request changed concurrently");
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: `request.${decision}`, entityType: "request", entityId: requestId, requestId: a.requestId });
    return toRequest(updated);
  });
}

/** Runs `fn` at most once per (site, key). A replay returns the stored response; a changed payload is rejected. */
async function idempotent<T>(tx: Tx, a: Actor, key: string, operation: string, payload: unknown, fn: () => Promise<T>): Promise<{ value: T; replayed: boolean }> {
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const inserted = await tx.insert(s.idempotencyKeys).values({ siteId: a.siteId, key, operation, requestHash }).onConflictDoNothing().returning();
  if (inserted.length === 0) {
    // The concurrent first attempt has committed (the conflicting insert blocks until it does).
    const [existing] = await tx.select().from(s.idempotencyKeys).where(and(eq(s.idempotencyKeys.siteId, a.siteId), eq(s.idempotencyKeys.key, key)));
    if (!existing || existing.requestHash !== requestHash || existing.operation !== operation) {
      throw new AppError(422, "idempotency_key_reuse", "Idempotency-Key was already used for a different request");
    }
    return { value: existing.responseBody as T, replayed: true };
  }
  const value = await fn();
  await tx.update(s.idempotencyKeys).set({ responseStatus: 201, responseBody: value as object }).where(and(eq(s.idempotencyKeys.siteId, a.siteId), eq(s.idempotencyKeys.key, key)));
  return { value, replayed: false };
}

/**
 * Allocates stock to an APPROVED request atomically:
 * lock request row -> verify status -> conditional decrement (never below zero) -> assignment + ledger -> status.
 * Any failure rolls back every step. Retrying with the same Idempotency-Key cannot allocate twice.
 */
export async function assignMaterial(db: Database, a: Actor, requestId: string, idempotencyKey: string): Promise<{ assignment: Assignment; replayed: boolean }> {
  return db.withTenant(scope(a), async (tx) => {
    const { value, replayed } = await idempotent(tx, a, idempotencyKey, "assignment.create", { requestId }, async () => {
      const req = await lockRequest(tx, a.siteId, requestId);
      if (!canTransition(requestTransitions, req.status, "assigned")) {
        throw conflict("invalid_transition", `Only approved requests can be assigned (current status: ${req.status})`);
      }
      const [item] = await tx
        .update(s.inventoryItems)
        .set({ onHand: sql`${s.inventoryItems.onHand} - ${req.quantity}`, updatedAt: new Date() })
        .where(and(eq(s.inventoryItems.id, req.itemId), eq(s.inventoryItems.siteId, a.siteId), gte(s.inventoryItems.onHand, req.quantity)))
        .returning();
      if (!item) {
        const [current] = await tx.select({ onHand: s.inventoryItems.onHand }).from(s.inventoryItems).where(eq(s.inventoryItems.id, req.itemId));
        throw new InsufficientStock(current?.onHand ?? 0, req.quantity);
      }
      const [assignment] = await tx.insert(s.assignments).values({ siteId: a.siteId, requestId, itemId: req.itemId, quantity: req.quantity, assignedBy: a.userId }).returning();
      await tx.insert(s.stockLedger).values({ siteId: a.siteId, itemId: req.itemId, delta: -req.quantity, balanceAfter: item.onHand, reason: "assignment", refType: "assignment", refId: assignment!.id, actorId: a.userId });
      await tx.update(s.requests).set({ status: "assigned", updatedAt: new Date() }).where(eq(s.requests.id, requestId));
      await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "assignment.created", entityType: "assignment", entityId: assignment!.id, metadata: { requestId, quantity: req.quantity }, requestId: a.requestId });
      return toAssignment(assignment!);
    });
    return { assignment: value, replayed };
  });
}

export async function recordConsumption(db: Database, a: Actor, assignmentId: string, quantity: number): Promise<ConsumptionRecord> {
  return db.withTenant(scope(a), async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`);
    const [assignment] = await tx.select().from(s.assignments).where(and(eq(s.assignments.siteId, a.siteId), eq(s.assignments.id, assignmentId)));
    if (!assignment) throw notFound("Assignment not found");
    const [{ used } = { used: 0 }] = await tx.select({ used: sql<number>`coalesce(sum(${s.consumptionRecords.quantity}), 0)::int` }).from(s.consumptionRecords).where(eq(s.consumptionRecords.assignmentId, assignmentId));
    if (used + quantity > assignment.quantity) {
      throw conflict("over_consumption", `Only ${assignment.quantity - used} unit(s) remain unconsumed on this assignment`);
    }
    const [row] = await tx.insert(s.consumptionRecords).values({ siteId: a.siteId, assignmentId, quantity, recordedBy: a.userId }).returning();
    if (used + quantity === assignment.quantity) {
      await tx.update(s.requests).set({ status: "fulfilled", updatedAt: new Date() }).where(and(eq(s.requests.id, assignment.requestId), eq(s.requests.status, "assigned")));
    }
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "consumption.recorded", entityType: "consumption", entityId: row!.id, metadata: { assignmentId, quantity }, requestId: a.requestId });
    return toConsumption(row!);
  });
}

export async function reconcileStock(db: Database, a: Actor) {
  return db.withTenant(scope(a), async (tx) => {
    const rows = await tx.execute<{ item_id: string; sku: string; on_hand: number; ledger_sum: number; reconciled: boolean }>(sql`select item_id, sku, on_hand, ledger_sum, reconciled from stock_reconciliation where site_id = ${a.siteId} order by sku`);
    return rows.rows;
  });
}

// ---------------------------------------------------------------- returns (Feature 3)

export async function listReturns(db: Database, a: Actor, page: number, pageSize: number): Promise<PaginatedResponse<ReturnRecord>> {
  return db.withTenant(scope(a), async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(s.returnRecords).where(eq(s.returnRecords.siteId, a.siteId));
    const rows = await tx.select().from(s.returnRecords).where(eq(s.returnRecords.siteId, a.siteId)).orderBy(desc(s.returnRecords.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return { items: rows.map(toReturn), page, pageSize, total };
  });
}

export async function createReturn(db: Database, a: Actor, input: { assignmentId: string; quantity: number }): Promise<ReturnRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [assignment] = await tx.select().from(s.assignments).where(and(eq(s.assignments.siteId, a.siteId), eq(s.assignments.id, input.assignmentId)));
    if (!assignment) throw notFound("Assignment not found");
    if (input.quantity > assignment.quantity) {
      throw conflict("invalid_quantity", `Return quantity (${input.quantity}) cannot exceed assignment quantity (${assignment.quantity})`);
    }
    const [row] = await tx.insert(s.returnRecords).values({
      siteId: a.siteId,
      assignmentId: input.assignmentId,
      quantity: input.quantity,
      status: "initiated",
      createdBy: a.userId,
    }).returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "return.initiated", entityType: "return", entityId: row!.id, metadata: { assignmentId: input.assignmentId, quantity: input.quantity }, requestId: a.requestId });
    return toReturn(row!);
  });
}

export async function updateReturnStatus(db: Database, a: Actor, returnId: string, toStatus: ReturnStatus): Promise<ReturnRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [ret] = await tx.select().from(s.returnRecords).where(and(eq(s.returnRecords.siteId, a.siteId), eq(s.returnRecords.id, returnId))).for("update");
    if (!ret) throw notFound("Return record not found");
    if (!canTransition(returnTransitions, ret.status, toStatus)) {
      throw conflict("invalid_transition", `A return in status "${ret.status}" cannot become "${toStatus}"`);
    }
    if (toStatus === "restocked") {
      const [assignment] = await tx.select().from(s.assignments).where(and(eq(s.assignments.siteId, a.siteId), eq(s.assignments.id, ret.assignmentId)));
      if (!assignment) throw notFound("Associated assignment not found");
      const [item] = await tx
        .update(s.inventoryItems)
        .set({ onHand: sql`${s.inventoryItems.onHand} + ${ret.quantity}`, updatedAt: new Date() })
        .where(and(eq(s.inventoryItems.id, assignment.itemId), eq(s.inventoryItems.siteId, a.siteId)))
        .returning();
      if (!item) throw notFound("Associated inventory item not found");
      await tx.insert(s.stockLedger).values({
        siteId: a.siteId,
        itemId: assignment.itemId,
        delta: ret.quantity,
        balanceAfter: item.onHand,
        reason: "return-restock",
        refType: "return",
        refId: ret.id,
        actorId: a.userId,
      });
    }
    const [updated] = await tx.update(s.returnRecords).set({ status: toStatus, updatedAt: new Date() }).where(and(eq(s.returnRecords.siteId, a.siteId), eq(s.returnRecords.id, returnId))).returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: `return.${toStatus}`, entityType: "return", entityId: returnId, requestId: a.requestId });
    return toReturn(updated!);
  });
}

// ---------------------------------------------------------------- repairs (Feature 2)

export async function listRepairs(db: Database, a: Actor, page: number, pageSize: number): Promise<PaginatedResponse<RepairRecord>> {
  return db.withTenant(scope(a), async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(s.repairRecords).where(eq(s.repairRecords.siteId, a.siteId));
    const rows = await tx.select().from(s.repairRecords).where(eq(s.repairRecords.siteId, a.siteId)).orderBy(desc(s.repairRecords.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return { items: rows.map(toRepair), page, pageSize, total };
  });
}

export async function createRepair(db: Database, a: Actor, input: { boardSerial: string }): Promise<RepairRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const active = await getActiveRelease(tx, a.siteId);
    if (!active) throw conflict("no_active_release", "Site has no active configuration release");
    const [existing] = await tx.select().from(s.repairRecords).where(and(eq(s.repairRecords.siteId, a.siteId), eq(s.repairRecords.boardSerial, input.boardSerial)));
    if (existing) throw conflict("duplicate_serial", `A repair record for board serial "${input.boardSerial}" already exists`);
    const [row] = await tx.insert(s.repairRecords).values({
      siteId: a.siteId,
      boardSerial: input.boardSerial,
      status: "received",
      technicianId: a.userId,
      releaseVersion: active.version,
    }).returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "repair.received", entityType: "repair", entityId: row!.id, metadata: { boardSerial: input.boardSerial }, requestId: a.requestId });
    return toRepair(row!);
  });
}

export async function updateRepairStatus(db: Database, a: Actor, repairId: string, toStatus: RepairStatus): Promise<RepairRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [rep] = await tx.select().from(s.repairRecords).where(and(eq(s.repairRecords.siteId, a.siteId), eq(s.repairRecords.id, repairId))).for("update");
    if (!rep) throw notFound("Repair record not found");
    if (!canTransition(repairTransitions, rep.status, toStatus)) {
      throw conflict("invalid_transition", `A repair in status "${rep.status}" cannot become "${toStatus}"`);
    }
    const [updated] = await tx.update(s.repairRecords).set({
      status: toStatus,
      technicianId: a.userId,
      updatedAt: new Date(),
    }).where(and(eq(s.repairRecords.siteId, a.siteId), eq(s.repairRecords.id, repairId))).returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: `repair.${toStatus}`, entityType: "repair", entityId: repairId, requestId: a.requestId });
    return toRepair(updated!);
  });
}

// ---------------------------------------------------------------- Analytics & Hub Overview

export async function getStockSummary(db: Database, a: Actor): Promise<StockSummary> {
  return db.withTenant(scope(a), async (tx) => {
    const [{ totalItems = 0 } = {}] = await tx.select({ totalItems: count() }).from(s.inventoryItems).where(eq(s.inventoryItems.siteId, a.siteId));
    const [{ belowReorder = 0 } = {}] = await tx.select({ belowReorder: count() }).from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), sql`${s.inventoryItems.onHand} <= ${s.inventoryItems.reorderLevel}`));
    return {
      totalItems: Number(totalItems),
      belowReorderLevel: Number(belowReorder),
      source: "database",
    };
  });
}

export async function getHubOverview(db: Database, userId: string): Promise<HubOverviewResponse> {
  return db.withoutTenant(async (tx) => {
    const [user] = await tx.select().from(s.users).where(eq(s.users.id, userId));
    if (!user) throw notFound("User not found");
    const siteRows = user.isPlatformAdmin
      ? await tx.select({ id: s.sites.id, name: s.sites.name, slug: s.sites.slug }).from(s.sites)
      : await tx.select({ id: s.sites.id, name: s.sites.name, slug: s.sites.slug })
          .from(s.userSiteRoles)
          .innerJoin(s.sites, eq(s.sites.id, s.userSiteRoles.siteId))
          .where(eq(s.userSiteRoles.userId, userId));

    const uniqueSitesMap = new Map<string, { id: string; name: string; slug: string }>();
    for (const r of siteRows) uniqueSitesMap.set(r.id, r);
    const sites = Array.from(uniqueSitesMap.values());
    if (sites.length === 0) {
      return {
        totals: { sites: 0, inventoryItems: 0, stockUnits: 0, pendingRequests: 0, pendingApprovals: 0, outstandingAssignments: 0 },
        sites: [],
      };
    }

    const perSite = new Map<string, {
      siteId: string;
      name: string;
      slug: string;
      inventoryItems: number;
      stockUnits: number;
      pendingRequests: number;
      pendingApprovals: number;
      outstandingAssignments: number;
    }>();

    for (const site of sites) {
      perSite.set(site.id, {
        siteId: site.id,
        name: site.name,
        slug: site.slug,
        inventoryItems: 0,
        stockUnits: 0,
        pendingRequests: 0,
        pendingApprovals: 0,
        outstandingAssignments: 0,
      });
    }

    const invRows = await tx.execute<{ site_id: string; items: number; units: number }>(sql`
      SELECT site_id, count(*)::int AS items, coalesce(sum(on_hand), 0)::float AS units
      FROM inventory_items GROUP BY site_id
    `);
    for (const r of invRows.rows) {
      const entry = perSite.get(r.site_id);
      if (entry) {
        entry.inventoryItems = Number(r.items);
        entry.stockUnits = Number(r.units);
      }
    }

    const reqRows = await tx.execute<{ site_id: string; status: string; n: number }>(sql`
      SELECT site_id, status, count(*)::int AS n
      FROM requests GROUP BY site_id, status
    `);
    for (const r of reqRows.rows) {
      const entry = perSite.get(r.site_id);
      if (entry) {
        if (["submitted", "draft"].includes(r.status)) entry.pendingRequests += Number(r.n);
        if (r.status === "submitted") entry.pendingApprovals += Number(r.n);
      }
    }

    const asgRows = await tx.execute<{ site_id: string; n: number }>(sql`
      SELECT site_id, count(*)::int AS n
      FROM assignments GROUP BY site_id
    `);
    for (const r of asgRows.rows) {
      const entry = perSite.get(r.site_id);
      if (entry) entry.outstandingAssignments = Number(r.n);
    }

    const siteList = Array.from(perSite.values());
    const sum = (k: "inventoryItems" | "stockUnits" | "pendingRequests" | "pendingApprovals" | "outstandingAssignments") =>
      siteList.reduce((acc, cur) => acc + cur[k], 0);

    return {
      totals: {
        sites: siteList.length,
        inventoryItems: sum("inventoryItems"),
        stockUnits: sum("stockUnits"),
        pendingRequests: sum("pendingRequests"),
        pendingApprovals: sum("pendingApprovals"),
        outstandingAssignments: sum("outstandingAssignments"),
      },
      sites: siteList,
    };
  });
}

export async function generateInventoryExcel(db: Database, a: Actor): Promise<Buffer> {
  return db.withTenant(scope(a), async (tx) => {
    const items = await tx.select().from(s.inventoryItems).where(eq(s.inventoryItems.siteId, a.siteId)).orderBy(s.inventoryItems.sku);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "OpsHub Platform";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Inventory");
    sheet.columns = [
      { header: "SKU", key: "sku", width: 18 },
      { header: "Item Name", key: "name", width: 32 },
      { header: "Unit", key: "unit", width: 12 },
      { header: "On Hand", key: "onHand", width: 14 },
      { header: "Reorder Level", key: "reorderLevel", width: 16 },
      { header: "Reorder Status", key: "status", width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const item of items) {
      const sanitize = (val: string) => (/^[=+\-@\t\r]/.test(val) ? `'${val}` : val);
      sheet.addRow({
        sku: sanitize(item.sku),
        name: sanitize(item.name),
        unit: sanitize(item.unit),
        onHand: item.onHand,
        reorderLevel: item.reorderLevel,
        status: item.onHand <= item.reorderLevel ? "REORDER NEEDED" : "OK",
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  });
}
