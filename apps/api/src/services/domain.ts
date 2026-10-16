import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { AnalyticsSummary, RepairRecord, RepairStatus, ReturnRecord, ReturnStatus, SiteMember } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
import { canTransition, repairTransitions } from "../workflows/transitions.js";
import { AppError, conflict, notFound } from "../utils/errors.js";
import { idempotent, InsufficientStock, type Actor } from "./operations.js";

const scope = (a: Actor) => ({ siteId: a.siteId, userId: a.userId });
const iso = (d: Date) => d.toISOString();

function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// =================================================================================================== returns

export const returnTransitions: Record<ReturnStatus, readonly ReturnStatus[]> = {
  initiated: ["inspected", "rejected"],
  inspected: ["restocked", "rejected"],
  restocked: [],
  rejected: [],
};

const toReturn = (r: typeof s.returnRecords.$inferSelect): ReturnRecord => ({ id: r.id, siteId: r.siteId, assignmentId: r.assignmentId, quantity: r.quantity, status: r.status, createdAt: iso(r.createdAt) });

/**
 * Spreads a returned quantity over an assignment's lines in a fixed order (item id), never giving a line more than
 * it was assigned. Pure, so the restock ledger entries are predictable and testable.
 */
export function allocateReturn(lines: { itemId: string; quantity: number }[], quantity: number): { itemId: string; quantity: number }[] {
  let left = quantity;
  const out: { itemId: string; quantity: number }[] = [];
  for (const l of [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    if (left <= 0) break;
    const take = Math.min(l.quantity, left);
    out.push({ itemId: l.itemId, quantity: take });
    left -= take;
  }
  return out;
}

export async function listReturns(db: Database, a: Actor): Promise<ReturnRecord[]> {
  return db.withTenant(scope(a), async (tx) => (await tx.select().from(s.returnRecords).where(eq(s.returnRecords.siteId, a.siteId)).orderBy(sql`${s.returnRecords.createdAt} desc`).limit(200)).map(toReturn));
}

/** Units of an assignment that can still be sent back: assigned, minus consumed, minus returns that are not rejected. */
async function returnable(tx: Tx, a: Actor, assignmentId: string): Promise<{ assignedQty: number; remaining: number; requestId: string }> {
  const [assignment] = await tx.select().from(s.assignments).where(and(eq(s.assignments.siteId, a.siteId), eq(s.assignments.id, assignmentId)));
  if (!assignment) throw notFound("Assignment not found");
  const [{ used } = { used: 0 }] = await tx.select({ used: sql<number>`coalesce(sum(${s.consumptionRecords.quantity}), 0)::int` }).from(s.consumptionRecords).where(eq(s.consumptionRecords.assignmentId, assignmentId));
  const [{ back } = { back: 0 }] = await tx
    .select({ back: sql<number>`coalesce(sum(${s.returnRecords.quantity}), 0)::int` })
    .from(s.returnRecords)
    .where(and(eq(s.returnRecords.assignmentId, assignmentId), sql`${s.returnRecords.status} <> 'rejected'`));
  return { assignedQty: assignment.quantity, remaining: assignment.quantity - used - back, requestId: assignment.requestId };
}

export async function createReturn(db: Database, a: Actor, input: { assignmentId: string; quantity: number }): Promise<ReturnRecord> {
  return db.withTenant(scope(a), async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.assignmentId}))`);
    const { remaining } = await returnable(tx, a, input.assignmentId);
    if (input.quantity > remaining) throw conflict("over_return", remaining <= 0 ? "Nothing on this assignment is left to return." : `Only ${remaining} unit(s) can still be returned from this assignment.`);
    const [row] = await tx.insert(s.returnRecords).values({ siteId: a.siteId, assignmentId: input.assignmentId, quantity: input.quantity, createdBy: a.userId }).returning();
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "return.initiated", entityType: "return", entityId: row!.id, metadata: { assignmentId: input.assignmentId, quantity: input.quantity }, requestId: a.requestId });
    return toReturn(row!);
  });
}

/** inspected -> restocked puts the units back on the shelf (ledger entries, once); every other step only changes status. */
export async function transitionReturn(db: Database, a: Actor, returnId: string, to: ReturnStatus, idempotencyKey?: string): Promise<ReturnRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const run = async (): Promise<ReturnRecord> => {
      const [cur] = await tx.select().from(s.returnRecords).where(and(eq(s.returnRecords.siteId, a.siteId), eq(s.returnRecords.id, returnId))).for("update");
      if (!cur) throw notFound("Return not found");
      if (!returnTransitions[cur.status].includes(to)) throw conflict("invalid_transition", `A return that is ${cur.status} cannot become ${to}.`);
      const [updated] = await tx.update(s.returnRecords).set({ status: to, updatedAt: new Date() }).where(and(eq(s.returnRecords.id, returnId), eq(s.returnRecords.status, cur.status))).returning();
      if (!updated) throw conflict("invalid_transition", "This return was changed by someone else. Reload and try again.");

      if (to === "restocked") {
        const [assignment] = await tx.select().from(s.assignments).where(eq(s.assignments.id, cur.assignmentId));
        const lines = await tx.select({ itemId: s.requestLines.itemId, quantity: s.requestLines.quantity }).from(s.requestLines).where(and(eq(s.requestLines.siteId, a.siteId), eq(s.requestLines.requestId, assignment!.requestId)));
        const plan = allocateReturn(lines, cur.quantity);
        const active = await getActiveRelease(tx, a.siteId);
        // Lock inventory rows in item-id order, like allocation does, so concurrent stock changes cannot deadlock.
        await tx.select({ id: s.inventoryItems.id }).from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), inArray(s.inventoryItems.id, plan.map((p) => p.itemId)))).orderBy(asc(s.inventoryItems.id)).for("update");
        for (const p of plan) {
          const [item] = await tx.update(s.inventoryItems).set({ onHand: sql`${s.inventoryItems.onHand} + ${p.quantity}`, updatedAt: new Date() }).where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, p.itemId))).returning();
          await tx.insert(s.stockLedger).values({ siteId: a.siteId, itemId: p.itemId, delta: p.quantity, balanceAfter: item!.onHand, reason: "return-restock", refType: "return", refId: returnId, actorId: a.userId, configVersion: active?.version ?? null });
        }
      }
      await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: `return.${to}`, entityType: "return", entityId: returnId, requestId: a.requestId });
      return toReturn(updated);
    };
    // Restocking moves stock, so a retried request (same key) must not add the units twice.
    if (to === "restocked" && idempotencyKey) return (await idempotent(tx, a, idempotencyKey, "return.restock", { returnId }, run)).value;
    return run();
  });
}

// =================================================================================================== repairs

const toRepair = (r: typeof s.repairRecords.$inferSelect): RepairRecord => ({ id: r.id, siteId: r.siteId, boardSerial: r.boardSerial, status: r.status, technicianId: r.technicianId, createdAt: iso(r.createdAt) });

export async function listRepairs(db: Database, a: Actor): Promise<RepairRecord[]> {
  return db.withTenant(scope(a), async (tx) => (await tx.select().from(s.repairRecords).where(eq(s.repairRecords.siteId, a.siteId)).orderBy(sql`${s.repairRecords.createdAt} desc`).limit(200)).map(toRepair));
}

export async function createRepair(db: Database, a: Actor, boardSerial: string): Promise<RepairRecord> {
  try {
    return await db.withTenant(scope(a), async (tx) => {
      const active = await getActiveRelease(tx, a.siteId);
      if (!active) throw conflict("no_active_release", "Site has no active configuration release");
      const [row] = await tx.insert(s.repairRecords).values({ siteId: a.siteId, boardSerial, releaseVersion: active.version }).returning();
      await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "repair.received", entityType: "repair", entityId: row!.id, metadata: { boardSerial }, configVersion: active.version, requestId: a.requestId });
      return toRepair(row!);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("duplicate_serial", `A repair for board “${boardSerial}” already exists.`);
    throw e;
  }
}

export async function transitionRepair(db: Database, a: Actor, repairId: string, to: RepairStatus): Promise<RepairRecord> {
  return db.withTenant(scope(a), async (tx) => {
    const [cur] = await tx.select().from(s.repairRecords).where(and(eq(s.repairRecords.siteId, a.siteId), eq(s.repairRecords.id, repairId))).for("update");
    if (!cur) throw notFound("Repair not found");
    if (!canTransition(repairTransitions, cur.status, to)) throw conflict("invalid_transition", `A repair that is ${cur.status} cannot become ${to}.`);
    const [row] = await tx
      .update(s.repairRecords)
      .set({ status: to, technicianId: cur.technicianId ?? a.userId, updatedAt: new Date() })
      .where(and(eq(s.repairRecords.id, repairId), eq(s.repairRecords.status, cur.status)))
      .returning();
    if (!row) throw conflict("invalid_transition", "This repair was changed by someone else. Reload and try again.");
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: `repair.${to}`, entityType: "repair", entityId: repairId, requestId: a.requestId });
    return toRepair(row);
  });
}

// =================================================================================================== stock adjustment

/** Manual stock correction: one ledger entry, never below zero, replay-safe with an idempotency key. */
export async function adjustStock(db: Database, a: Actor, itemId: string, delta: number, reason: string, key: string): Promise<{ onHand: number; replayed: boolean }> {
  return db.withTenant(scope(a), async (tx) => {
    const { value, replayed } = await idempotent(tx, a, key, "stock.adjust", { itemId, delta, reason }, async () => {
      const [item] = await tx.select().from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, a.siteId), eq(s.inventoryItems.id, itemId))).for("update");
      if (!item) throw notFound("Item not found");
      if (item.onHand + delta < 0) throw new InsufficientStock(item.onHand, -delta);
      const [updated] = await tx.update(s.inventoryItems).set({ onHand: item.onHand + delta, updatedAt: new Date() }).where(eq(s.inventoryItems.id, itemId)).returning();
      const active = await getActiveRelease(tx, a.siteId);
      await tx.insert(s.stockLedger).values({ siteId: a.siteId, itemId, delta, balanceAfter: updated!.onHand, reason: "adjustment", refType: "manual", actorId: a.userId, configVersion: active?.version ?? null });
      await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: "stock.adjusted", entityType: "inventory_item", entityId: itemId, metadata: { delta, reason }, configVersion: active?.version, requestId: a.requestId });
      return { onHand: updated!.onHand };
    });
    return { onHand: value.onHand, replayed };
  });
}

// =================================================================================================== analytics

export interface AnalyticsScope {
  stock: boolean;
  requests: boolean;
  returns: boolean;
  repairs: boolean;
}

const countBy = async (tx: Tx, table: typeof s.requests | typeof s.returnRecords | typeof s.repairRecords, siteId: string): Promise<Record<string, number>> => {
  const rows = await tx.select({ status: table.status, n: sql<number>`count(*)::int` }).from(table).where(eq(table.siteId, siteId)).groupBy(table.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
};

/** Server-side aggregates for one site; each block is computed only if the caller may see that kind of record. */
export async function analyticsSummary(db: Database, a: Actor, allowed: AnalyticsScope): Promise<AnalyticsSummary> {
  return db.withTenant(scope(a), async (tx) => {
    const active = await getActiveRelease(tx, a.siteId);
    const cfg = active ? parseStoredConfig(active.configuration) : null;

    let stock: AnalyticsSummary["stock"] = null;
    let movements: AnalyticsSummary["movements"] = null;
    if (allowed.stock) {
      const [row] = await tx
        .select({
          totalItems: sql<number>`count(*)::int`,
          totalOnHand: sql<number>`coalesce(sum(${s.inventoryItems.onHand}), 0)::int`,
          below: sql<number>`count(*) filter (where ${s.inventoryItems.onHand} <= ${s.inventoryItems.reorderLevel})::int`,
          out: sql<number>`count(*) filter (where ${s.inventoryItems.onHand} = 0)::int`,
        })
        .from(s.inventoryItems)
        .where(eq(s.inventoryItems.siteId, a.siteId));
      stock = { totalItems: row?.totalItems ?? 0, totalOnHand: row?.totalOnHand ?? 0, belowReorderLevel: row?.below ?? 0, outOfStock: row?.out ?? 0 };
      const since = new Date(Date.now() - 13 * 86_400_000);
      since.setUTCHours(0, 0, 0, 0);
      const days = await tx
        .select({
          day: sql<string>`to_char(date_trunc('day', ${s.stockLedger.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
          unitsIn: sql<number>`coalesce(sum(${s.stockLedger.delta}) filter (where ${s.stockLedger.delta} > 0), 0)::int`,
          unitsOut: sql<number>`coalesce(-sum(${s.stockLedger.delta}) filter (where ${s.stockLedger.delta} < 0), 0)::int`,
        })
        .from(s.stockLedger)
        .where(and(eq(s.stockLedger.siteId, a.siteId), gte(s.stockLedger.createdAt, since)))
        .groupBy(sql`1`);
      const byDay = new Map(days.map((d) => [d.day, d]));
      movements = Array.from({ length: 14 }, (_, i) => {
        const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
        return { day, unitsIn: byDay.get(day)?.unitsIn ?? 0, unitsOut: byDay.get(day)?.unitsOut ?? 0 };
      });
    }

    let requests: AnalyticsSummary["requests"] = null;
    if (allowed.requests) {
      const sla = cfg?.modules.nodes.find((n) => n.moduleType === "approval")?.config["slaSeconds"];
      let overdue: number | null = null;
      if (typeof sla === "number" && sla > 0) {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(s.requests)
          .where(and(eq(s.requests.siteId, a.siteId), eq(s.requests.status, "submitted"), sql`${s.requests.statusChangedAt} < now() - make_interval(secs => ${sla})`));
        overdue = row?.n ?? 0;
      }
      requests = { byStatus: await countBy(tx, s.requests, a.siteId), overdue };
    }

    return {
      stock,
      requests,
      movements,
      returns: allowed.returns ? { byStatus: await countBy(tx, s.returnRecords, a.siteId) } : null,
      repairs: allowed.repairs ? { byStatus: await countBy(tx, s.repairRecords, a.siteId) } : null,
      source: "database",
    };
  });
}

// =================================================================================================== members

async function siteRoleKeys(tx: Tx, siteId: string): Promise<Set<string>> {
  const active = await getActiveRelease(tx, siteId);
  return new Set(active ? parseStoredConfig(active.configuration).roles.map((r) => r.id) : []);
}

export async function listMembers(db: Database, a: Actor): Promise<SiteMember[]> {
  return db.withTenant(scope(a), async (tx) => {
    const rows = await tx
      .select({ userId: s.users.id, email: s.users.email, displayName: s.users.displayName, role: s.roles.key })
      .from(s.userSiteRoles)
      .innerJoin(s.users, eq(s.users.id, s.userSiteRoles.userId))
      .innerJoin(s.roles, eq(s.roles.id, s.userSiteRoles.roleId))
      .where(eq(s.userSiteRoles.siteId, a.siteId))
      .orderBy(s.users.email);
    const byUser = new Map<string, SiteMember>();
    for (const r of rows) {
      const m = byUser.get(r.userId) ?? { userId: r.userId, email: r.email, displayName: r.displayName, roles: [] };
      m.roles.push(r.role);
      byUser.set(r.userId, m);
    }
    return [...byUser.values()];
  });
}

/** Sets exactly these roles for a member of this site (adding them to the site if needed). Roles must exist in the active release. */
export async function setMemberRoles(db: Database, a: Actor, target: { userId?: string; email?: string }, roleKeys: string[]): Promise<SiteMember> {
  return db.withTenant(scope(a), async (tx) => {
    const allowed = await siteRoleKeys(tx, a.siteId);
    const unknown = roleKeys.filter((k) => !allowed.has(k));
    if (unknown.length > 0) throw new AppError(422, "unknown_role", `This site has no role called “${unknown[0]}”.`);
    const [user] = await tx
      .select({ id: s.users.id, isSystem: sql<boolean>`${s.users.email} like '%@system.invalid'` })
      .from(s.users)
      .where(target.userId ? eq(s.users.id, target.userId) : eq(s.users.email, target.email ?? ""));
    if (!user || user.isSystem) throw new AppError(404, "user_not_found", "No account with that email exists. Ask the person to get an account first.");
    if (user.id === a.userId) throw new AppError(403, "self_edit", "You cannot change your own roles here.");
    const roleRows = roleKeys.length ? await tx.select().from(s.roles).where(inArray(s.roles.key, roleKeys)) : [];
    if (roleRows.length !== new Set(roleKeys).size) throw new AppError(422, "unknown_role", "One of those roles is not available on this platform.");

    await tx.delete(s.userSiteRoles).where(and(eq(s.userSiteRoles.siteId, a.siteId), eq(s.userSiteRoles.userId, user.id)));
    if (roleRows.length) await tx.insert(s.userSiteRoles).values(roleRows.map((r) => ({ userId: user.id, siteId: a.siteId, roleId: r.id })));
    await recordAudit(tx, { siteId: a.siteId, actorId: a.userId, action: roleKeys.length ? "member.roles-set" : "member.removed", entityType: "user", entityId: user.id, metadata: { roles: roleKeys }, requestId: a.requestId });
    const members = await listMembersIn(tx, a.siteId);
    return members.find((m) => m.userId === user.id) ?? { userId: user.id, email: target.email ?? "", displayName: "", roles: [] };
  });
}

async function listMembersIn(tx: Tx, siteId: string): Promise<SiteMember[]> {
  const rows = await tx
    .select({ userId: s.users.id, email: s.users.email, displayName: s.users.displayName, role: s.roles.key })
    .from(s.userSiteRoles)
    .innerJoin(s.users, eq(s.users.id, s.userSiteRoles.userId))
    .innerJoin(s.roles, eq(s.roles.id, s.userSiteRoles.roleId))
    .where(eq(s.userSiteRoles.siteId, siteId));
  const byUser = new Map<string, SiteMember>();
  for (const r of rows) {
    const m = byUser.get(r.userId) ?? { userId: r.userId, email: r.email, displayName: r.displayName, roles: [] };
    m.roles.push(r.role);
    byUser.set(r.userId, m);
  }
  return [...byUser.values()];
}

export async function addMember(db: Database, a: Actor, email: string, role: string): Promise<SiteMember> {
  const current = (await listMembers(db, a)).find((m) => m.email === email);
  return setMemberRoles(db, a, { email }, [...new Set([...(current?.roles ?? []), role])]);
}
