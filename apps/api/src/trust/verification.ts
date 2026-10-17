// src/trust/verification.ts
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/scoped.js";
import { resolveSiteAccess } from "../security/access.js";
import * as s from "../db/schema/index.js";

/**
 * Tenant tables are under FORCE ROW LEVEL SECURITY: a query without tenant context sees ZERO rows,
 * so a check written that way would pass vacuously. Every check below therefore lists the real
 * sites first and then reads each one inside its own tenant transaction.
 */
async function realSites(db: Database, userId: string): Promise<{ id: string; slug: string }[]> {
  return db.withUser(userId, (tx) => tx.select({ id: s.sites.id, slug: s.sites.slug }).from(s.sites).where(eq(s.sites.isSystem, false)));
}

/** Verify tenant isolation: ensure the authenticated user cannot access another site. */
export async function tenantIsolationCheck(db: Database, userId: string) {
  const memberships = await db.withUser(userId, (tx) => tx.select({ siteId: s.userSiteRoles.siteId }).from(s.userSiteRoles).where(eq(s.userSiteRoles.userId, userId)));
  const memberSiteIds = memberships.map((m) => m.siteId);
  const sites = await realSites(db, userId);
  const other = sites.find((x) => !memberSiteIds.includes(x.id));
  if (!other) return { passed: false, detail: "Not run: there is no site outside this user's memberships to test against." };
  const access = await resolveSiteAccess(db, { id: userId, isPlatformAdmin: false }, other.id);
  const passed = access === null;
  return { passed, detail: passed ? "Cross-site access correctly denied." : "User could resolve access to another tenant!" };
}

/** Verify inventory integrity invariants, site by site, under each site's own tenant context. */
export async function inventoryIntegrityCheck(db: Database, userId: string) {
  const sites = await realSites(db, userId);
  if (sites.length === 0) return { passed: false, detail: "Not run: no sites are visible to this user." };

  const issues: string[] = [];
  let items = 0;
  for (const site of sites) {
    await db.withTenant({ siteId: site.id, userId }, async (tx) => {
      const [counts] = (await tx.execute<{ items: number; negative: number }>(sql`
        select count(*)::int as items, count(*) filter (where on_hand < 0)::int as negative
        from inventory_items where site_id = ${site.id}`)).rows;
      items += counts?.items ?? 0;
      if (counts && counts.negative > 0) issues.push(`${site.slug}: ${counts.negative} items with negative stock.`);

      const mismatched = (await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from (
          select i.id from inventory_items i
          left join stock_ledger l on l.item_id = i.id
          where i.site_id = ${site.id}
          group by i.id, i.on_hand
          having i.on_hand <> coalesce(sum(l.delta), 0)
        ) t`)).rows[0]?.n ?? 0;
      if (mismatched > 0) issues.push(`${site.slug}: ${mismatched} items do not reconcile with the stock ledger.`);

      const duplicated = (await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from (
          select 1 from stock_ledger
          where site_id = ${site.id} and ref_id is not null
          group by item_id, ref_type, ref_id, reason
          having count(*) > 1
        ) t`)).rows[0]?.n ?? 0;
      if (duplicated > 0) issues.push(`${site.slug}: ${duplicated} duplicate ledger entries.`);
    });
  }
  const passed = issues.length === 0;
  return { passed, detail: passed ? `All inventory invariants hold across ${sites.length} site(s), ${items} item(s).` : issues.join(" ") };
}

/** Retrieve recent audit events (last 200 across the sites visible to the caller). */
export async function recentAuditEvents(db: Database, userId: string) {
  const sites = await realSites(db, userId);
  const perSite = await Promise.all(
    sites.map((site) => db.withTenant({ siteId: site.id, userId }, (tx) => tx.select().from(s.auditEvents).where(eq(s.auditEvents.siteId, site.id)).orderBy(desc(s.auditEvents.createdAt)).limit(200))),
  );
  return perSite
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 200)
    .map((r) => ({
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
