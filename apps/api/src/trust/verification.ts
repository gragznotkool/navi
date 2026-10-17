// src/trust/verification.ts
import type { Database } from "../db/scoped.js";
import { resolveSiteAccess } from "../security/access.js";
import * as s from "../db/schema/index.js";
import { sql } from "drizzle-orm";

/** Verify tenant isolation: ensure the authenticated user cannot access another site. */
export async function tenantIsolationCheck(db: Database, userId: string) {
  const memberships = await db.withUser(userId, async (tx) =>
    tx.select({ siteId: s.userSiteRoles.siteId }).from(s.userSiteRoles).where(sql`user_id = ${userId}`)
  );
  const memberSiteIds = memberships.map((m) => m.siteId);
  const otherSite = await db.withoutTenant(async (tx) =>
    tx.select({ id: s.sites.id }).from(s.sites).where(sql`id NOT IN (${memberSiteIds.length ? memberSiteIds : ['']})`).limit(1)
  );
  if (!otherSite[0]) return { passed: true, detail: "No other site exists to test isolation." };
  const otherSiteId = otherSite[0]!.id;
  const access = await resolveSiteAccess(db, { id: userId, isPlatformAdmin: false }, otherSiteId);
  const passed = access === null;
  const detail = passed ? "Cross‑site access correctly denied." : "User could resolve access to another tenant!";
  return { passed, detail };
}

/** Verify inventory integrity invariants. */
export async function inventoryIntegrityCheck(db: Database) {
  const issues: string[] = [];
  const negItems = await db.withoutTenant(async (tx) =>
    tx.select({ id: s.inventoryItems.id, sku: s.inventoryItems.sku, onHand: s.inventoryItems.onHand })
      .from(s.inventoryItems)
      .where(sql`on_hand < 0`)
  );
  if (negItems.length) issues.push(`${negItems.length} items with negative onHand.`);
  const mismatches = await db.withoutTenant(async (tx) =>
    tx.execute<{ itemId: string; onHand: number; ledgerSum: number }>(sql`
      SELECT i.id AS "itemId", i.on_hand AS "onHand", COALESCE(SUM(l.delta),0) AS "ledgerSum"
      FROM ${s.inventoryItems} i
      LEFT JOIN ${s.stockLedger} l ON l.item_id = i.id
      GROUP BY i.id, i.on_hand
      HAVING i.on_hand != COALESCE(SUM(l.delta),0)
    `)
  );
  if (mismatches.length) issues.push(`${mismatches.length} items have ledger sum mismatch.`);
  const dupLedger = await db.withoutTenant(async (tx) =>
    tx.execute(sql`
      SELECT COUNT(*) AS cnt FROM ${s.stockLedger}
      GROUP BY ref_type, ref_id, reason
      HAVING COUNT(*) > 1
    `)
  );
  if (dupLedger.length) issues.push(`${dupLedger.length} duplicate ledger entries detected.`);
  const passed = issues.length === 0;
  return { passed, detail: passed ? "All inventory invariants hold." : issues.join(" ") };
}

/** Retrieve recent audit events (last 200). */
export async function recentAuditEvents(db: Database) {
  const rows = await db.withoutTenant(async (tx) =>
    tx.select().from(s.auditEvents).orderBy(s.auditEvents.createdAt).limit(200)
  );
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    actorId: r.actorId,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
    metadata: r.metadata,
  }));
}
