import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Assignment, ConsumptionRecord, PaginatedResponse, RequestRecord, StockItem } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease } from "../repositories/releases.js";
import { canTransition, requestTransitions } from "../workflows/transitions.js";
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
