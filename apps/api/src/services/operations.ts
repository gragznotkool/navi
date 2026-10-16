import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Assignment, ConsumptionRecord, PaginatedResponse, RequestRecord, SiteConfiguration, StockItem } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { validateExtras, visibleExtras } from "../fields/runtime.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
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

const toStockItem = (r: typeof s.inventoryItems.$inferSelect, cfg: SiteConfiguration | null): StockItem => ({
  id: r.id,
  siteId: r.siteId,
  sku: r.sku,
  name: r.name,
  unit: r.unit,
  onHand: r.onHand,
  reorderLevel: r.reorderLevel,
  extras: cfg ? visibleExtras(cfg, "inventory_item", r.extras) : {},
  updatedAt: r.updatedAt.toISOString(),
});
type LineRow = typeof s.requestLines.$inferSelect & { sku: string; name: string };

const toRequest = (r: typeof s.requests.$inferSelect, lines: LineRow[], cfg: SiteConfiguration | null): RequestRecord => ({
  id: r.id,
  siteId: r.siteId,
  lines: lines.map((l) => ({ id: l.id, itemId: l.itemId, sku: l.sku, name: l.name, quantity: l.quantity, extras: cfg ? visibleExtras(cfg, "request_line", l.extras) : {} })),
  status: r.status,
  requestedBy: r.requestedBy,
  releaseVersion: r.releaseVersion,
  createdAt: r.createdAt.toISOString(),
  statusChangedAt: r.statusChangedAt.toISOString(),
  ageSeconds: Math.max(0, Math.floor((Date.now() - r.statusChangedAt.getTime()) / 1000)),
});

/** The active configuration for the tenant in `tx`, or null when the site has no release. */
async function activeConfig(tx: Tx, siteId: string): Promise<SiteConfiguration | null> {
  const active = await getActiveRelease(tx, siteId);
  return active ? parseStoredConfig(active.configuration) : null;
}

/** Loads lines for the given requests, grouped by request, in a stable (item id) order. */
async function linesFor(tx: Tx, siteId: string, requestIds: string[]) {
  const byRequest = new Map<string, LineRow[]>();
  if (requestIds.length === 0) return byRequest;
  const rows = await tx
    .select({ line: s.requestLines, sku: s.inventoryItems.sku, name: s.inventoryItems.name })
    .from(s.requestLines)
    .innerJoin(s.inventoryItems, and(eq(s.inventoryItems.siteId, s.requestLines.siteId), eq(s.inventoryItems.id, s.requestLines.itemId)))
    .where(and(eq(s.requestLines.siteId, siteId), inArray(s.requestLines.requestId, requestIds)))
    .orderBy(asc(s.requestLines.itemId));
  for (const { line, sku, name } of rows) byRequest.set(line.requestId, [...(byRequest.get(line.requestId) ?? []), { ...line, sku, name }]);
  return byRequest;
}
const toAssignment = (r: typeof s.assignments.$inferSelect, lines: LineRow[]): Assignment => ({
  id: r.id,
  siteId: r.siteId,
  requestId: r.requestId,
  quantity: r.quantity,
  configVersion: r.configVersion,
  lines: lines.map((l) => ({ id: l.id, itemId: l.itemId, sku: l.sku, name: l.name, quantity: l.quantity })),
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
    const cfg = await activeConfig(tx, a.siteId);
    return { items: rows.map((r) => toStockItem(r, cfg)), page, pageSize, total };
  });
}

export async function getItem(db: Database, a: Actor, itemId: string) {
  return db.withTenant(scope(a), async (tx) => {
    const [row] = await tx.select().from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, itemId)));
    if (!row) throw notFound("Item not found");
    const ledger = await tx.select().from(s.stockLedger).where(eq(s.stockLedger.itemId, itemId)).orderBy(desc(s.stockLedger.createdAt)).limit(50);
    return {
      item: toStockItem(row, await activeConfig(tx, a.siteId)),
      ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, balanceAfter: l.balanceAfter, reason: l.reason, refType: l.refType, refId: l.refId, createdAt: l.createdAt.toISOString() })),
    };
  });
}

export async function listRequests(db: Database, a: Actor, page: number, pageSize: number): Promise<PaginatedResponse<RequestRecord>> {
  return db.withTenant(scope(a), async (tx) => {
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(s.requests).where(eq(s.requests.siteId, a.siteId));
    const rows = await tx.select().from(s.requests).where(eq(s.requests.siteId, a.siteId)).orderBy(desc(s.requests.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const lines = await linesFor(tx, a.siteId, rows.map((r) => r.id));
    const cfg = await activeConfig(tx, a.siteId);
    return { items: rows.map((r) => toRequest(r, lines.get(r.id) ?? [], cfg)), page, pageSize, total };
  });
}

export async function getRequest(db: Database, a: Actor, id: string): Promise<RequestRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [row] = await tx.select().from(s.requests).where(and(eq(s.requests.siteId, a.siteId), eq(s.requests.id, id)));
    if (!row) throw notFound("Request not found");
    return toRequest(row, (await linesFor(tx, a.siteId, [row.id])).get(row.id) ?? [], await activeConfig(tx, a.siteId));
  });
}

export async function listAssignments(db: Database, a: Actor): Promise<Assignment[]> {
  return db.withTenant(scope(a), async (tx) => {
    const rows = await tx.select().from(s.assignments).where(eq(s.assignments.siteId, a.siteId)).orderBy(desc(s.assignments.createdAt)).limit(100);
    const lines = await linesFor(tx, a.siteId, rows.map((r) => r.requestId));
    return rows.map((r) => toAssignment(r, lines.get(r.requestId) ?? []));
  });
}

// ---------------------------------------------------------------- writes

export type CreateRequestInput = { lines: { itemId: string; quantity: number; extras?: Record<string, unknown> | undefined }[]; note?: string | undefined };

export async function createRequest(db: Database, a: Actor, input: CreateRequestInput): Promise<RequestRecord> {
  return db.withTenant(scope(a), (tx) => createRequestIn(tx, a, input));
}

/** The body of `createRequest`, usable inside a caller's transaction (offline sync applies it under an idempotency key). */
export async function createRequestIn(tx: Tx, a: Actor, input: CreateRequestInput): Promise<RequestRecord> {
  {
    const itemIds = input.lines.map((l) => l.itemId);
    const found = await tx.select({ id: s.inventoryItems.id }).from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), inArray(s.inventoryItems.id, itemIds)));
    if (found.length !== new Set(itemIds).size) throw notFound("Item not found");
    const active = await getActiveRelease(tx, a.siteId);
    if (!active) throw conflict("no_active_release", "Site has no active configuration release");
    const cfg = parseStoredConfig(active.configuration);
    const cleaned = input.lines.map((l) => ({ ...l, extras: validateExtras(cfg, "request_line", l.extras, { requireAll: true }) }));
    const [row] = await tx
      .insert(s.requests)
      .values({ siteId: a.siteId, status: "submitted", requestedBy: a.userId, releaseVersion: active.version, note: input.note ?? null })
      .returning();
    const lines = await tx
      .insert(s.requestLines)
      .values(cleaned.map((l) => ({ siteId: a.siteId, requestId: row!.id, itemId: l.itemId, quantity: l.quantity, extras: l.extras })))
      .returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "request.submitted", entityType: "request", entityId: row!.id, configVersion: active.version, requestId: a.requestId });
    return toRequest(row!, (await linesFor(tx, a.siteId, [row!.id])).get(row!.id) ?? lines.map((l) => ({ ...l, sku: "", name: "" })), cfg);
  }
}

/** Sets (or clears, with null) configured field values on an item. Hidden fields' stored values are untouched. */
export async function updateItemExtras(db: Database, a: Actor, itemId: string, extras: Record<string, unknown>): Promise<StockItem> {
  return db.withTenant(scope(a), async (tx) => {
    const active = await getActiveRelease(tx, a.siteId);
    if (!active) throw conflict("no_active_release", "Site has no active configuration release");
    const cfg = parseStoredConfig(active.configuration);
    const [row] = await tx.select().from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, itemId))).for("update");
    if (!row) throw notFound("Item not found");
    const cleaned = validateExtras(cfg, "inventory_item", extras, { requireAll: false, allowClear: true });
    const merged: Record<string, unknown> = { ...(row.extras as Record<string, unknown>) };
    for (const [k, v] of Object.entries(cleaned)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const [updated] = await tx.update(s.inventoryItems).set({ extras: merged, updatedAt: new Date() }).where(eq(s.inventoryItems.id, itemId)).returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "item.fields-updated", entityType: "inventory_item", entityId: itemId, metadata: { keys: Object.keys(cleaned) }, configVersion: active.version, requestId: a.requestId });
    return toStockItem(updated!, cfg);
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
    const [updated] = await tx.update(s.requests).set({ status: decision, updatedAt: new Date(), statusChangedAt: new Date() }).where(and(eq(s.requests.id, requestId), eq(s.requests.status, "submitted"))).returning();
    if (!updated) throw conflict("invalid_transition", "Request changed concurrently");
    const active = await getActiveRelease(tx, a.siteId);
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: `request.${decision}`, entityType: "request", entityId: requestId, configVersion: active?.version, requestId: a.requestId });
    return toRequest(updated, (await linesFor(tx, a.siteId, [requestId])).get(requestId) ?? [], await activeConfig(tx, a.siteId));
  });
}

/** Runs `fn` at most once per (site, key). A replay returns the stored response; a changed payload is rejected. */
export async function idempotent<T>(tx: Tx, a: Actor, key: string, operation: string, payload: unknown, fn: () => Promise<T>): Promise<{ value: T; replayed: boolean }> {
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
      const lines = (await linesFor(tx, a.siteId, [requestId])).get(requestId) ?? [];
      // Lock inventory rows in ascending item_id order so concurrent multi-line requests cannot deadlock.
      const itemIds = lines.map((l) => l.itemId);
      const locked = await tx
        .select({ id: s.inventoryItems.id, onHand: s.inventoryItems.onHand })
        .from(s.inventoryItems)
        .where(and(eq(s.inventoryItems.siteId, a.siteId), inArray(s.inventoryItems.id, itemIds)))
        .orderBy(asc(s.inventoryItems.id))
        .for("update");
      const onHand = new Map(locked.map((r) => [r.id, r.onHand]));
      for (const l of lines) {
        const have = onHand.get(l.itemId) ?? 0;
        if (have < l.quantity) throw new InsufficientStock(have, l.quantity);
      }
      const active = await getActiveRelease(tx, a.siteId);
      const configVersion = active?.version ?? null;
      const total = lines.reduce((n, l) => n + l.quantity, 0);
      const [assignment] = await tx.insert(s.assignments).values({ siteId: a.siteId, requestId, quantity: total, assignedBy: a.userId, configVersion }).returning();
      for (const l of lines) {
        const [item] = await tx
          .update(s.inventoryItems)
          .set({ onHand: sql`${s.inventoryItems.onHand} - ${l.quantity}`, updatedAt: new Date() })
          .where(and(eq(s.inventoryItems.id, l.itemId), eq(s.inventoryItems.siteId, a.siteId), gte(s.inventoryItems.onHand, l.quantity)))
          .returning();
        if (!item) throw new InsufficientStock(onHand.get(l.itemId) ?? 0, l.quantity);
        await tx.insert(s.stockLedger).values({ siteId: a.siteId, itemId: l.itemId, delta: -l.quantity, balanceAfter: item.onHand, reason: "assignment", refType: "request_line", refId: l.id, actorId: a.userId, configVersion });
      }
      await tx.update(s.requests).set({ status: "assigned", updatedAt: new Date(), statusChangedAt: new Date() }).where(eq(s.requests.id, requestId));
      await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "assignment.created", entityType: "assignment", entityId: assignment!.id, metadata: { requestId, quantity: total, lines: lines.length }, configVersion: configVersion ?? undefined, requestId: a.requestId });
      return toAssignment(assignment!, lines);
    });
    return { assignment: value, replayed };
  });
}

export async function recordConsumption(db: Database, a: Actor, assignmentId: string, quantity: number): Promise<ConsumptionRecord> {
  return db.withTenant(scope(a), (tx) => recordConsumptionIn(tx, a, assignmentId, quantity));
}

export async function recordConsumptionIn(tx: Tx, a: Actor, assignmentId: string, quantity: number): Promise<ConsumptionRecord> {
  {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`);
    const [assignment] = await tx.select().from(s.assignments).where(and(eq(s.assignments.siteId, a.siteId), eq(s.assignments.id, assignmentId)));
    if (!assignment) throw notFound("Assignment not found");
    const [{ used } = { used: 0 }] = await tx.select({ used: sql<number>`coalesce(sum(${s.consumptionRecords.quantity}), 0)::int` }).from(s.consumptionRecords).where(eq(s.consumptionRecords.assignmentId, assignmentId));
    if (used + quantity > assignment.quantity) {
      throw conflict("over_consumption", `Only ${assignment.quantity - used} unit(s) remain unconsumed on this assignment`);
    }
    const [row] = await tx.insert(s.consumptionRecords).values({ siteId: a.siteId, assignmentId, quantity, recordedBy: a.userId }).returning();
    if (used + quantity === assignment.quantity) {
      await tx.update(s.requests).set({ status: "fulfilled", updatedAt: new Date(), statusChangedAt: new Date() }).where(and(eq(s.requests.id, assignment.requestId), eq(s.requests.status, "assigned")));
    }
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "consumption.recorded", entityType: "consumption", entityId: row!.id, metadata: { assignmentId, quantity }, configVersion: (await getActiveRelease(tx, a.siteId))?.version, requestId: a.requestId });
    return toConsumption(row!);
  }
}

export async function reconcileStock(db: Database, a: Actor) {
  return db.withTenant(scope(a), async (tx) => {
    const rows = await tx.execute<{ item_id: string; sku: string; on_hand: number; ledger_sum: number; reconciled: boolean }>(sql`select item_id, sku, on_hand, ledger_sum, reconciled from stock_reconciliation where site_id = ${a.siteId} order by sku`);
    return rows.rows;
  });
}
