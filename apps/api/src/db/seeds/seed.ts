import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { SiteConfiguration } from "@opshub/contracts";
import { compileConfiguration } from "../../compiler/compile.js";
import * as s from "../schema/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sitesDir = resolve(here, "../../../../../config/sites");

/** Reserved system site used by live Trust Console proofs. */
export const TRUST_LAB_SITE_ID = "00000000-0000-4000-8000-0000000000aa";

/** LOCAL DEVELOPMENT ONLY credentials. Never used outside seeded demo databases. */
export const DEV_PASSWORD = "opshub-dev-1";

const roleNames: Record<string, string> = {
  admin: "Administrator",
  storekeeper: "Storekeeper",
  viewer: "Viewer",
  technician: "Technician",
  approver: "Approver",
  dispatcher: "Dispatcher",
};

const devUsers = [
  { id: "10000000-0000-4000-8000-000000000001", email: "admin@opshub.local", name: "Platform Admin", platformAdmin: true, memberships: { "central-stores": ["admin"], "service-centre": ["admin"], distribution: ["admin"] } },
  { id: "10000000-0000-4000-8000-000000000002", email: "storekeeper@opshub.local", name: "Sam Storekeeper", platformAdmin: false, memberships: { "central-stores": ["storekeeper"] } },
  { id: "10000000-0000-4000-8000-000000000003", email: "technician@opshub.local", name: "Tara Technician", platformAdmin: false, memberships: { "service-centre": ["technician"] } },
  { id: "10000000-0000-4000-8000-000000000004", email: "approver@opshub.local", name: "Avi Approver", platformAdmin: false, memberships: { "service-centre": ["approver"], distribution: ["approver"] } },
  { id: "10000000-0000-4000-8000-000000000005", email: "dispatcher@opshub.local", name: "Dev Dispatcher", platformAdmin: false, memberships: { distribution: ["dispatcher"] } },
] as const;

/** Demo stock (clearly seed data). Quantity becomes an opening-balance ledger entry. */
const demoStock: Record<string, { sku: string; name: string; unit: string; qty: number; reorder: number; price?: number }[]> = {
  "central-stores": [
    { sku: "BRG-6204", name: "Ball bearing 6204", unit: "each", qty: 120, reorder: 40, price: 180 },
    { sku: "FLT-OIL-10", name: "Oil filter 10 micron", unit: "each", qty: 18, reorder: 25, price: 420 },
    { sku: "GSK-KIT-A", name: "Gasket kit A", unit: "kit", qty: 60, reorder: 20, price: 95 },
  ],
  distribution: [
    { sku: "CBL-3C-2.5", name: "Cable 3-core 2.5mm", unit: "metre", qty: 500, reorder: 100 },
    { sku: "MCB-16A", name: "MCB 16A single pole", unit: "each", qty: 80, reorder: 30 },
  ],
};

function loadSiteConfigs(): SiteConfiguration[] {
  return readdirSync(sitesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw: unknown = JSON.parse(readFileSync(join(sitesDir, f), "utf8"));
      const out = compileConfiguration(raw);
      if (!out.compiled) {
        throw new Error(`Seed config ${f} failed validation: ${out.result.errors.map((e) => e.message).join("; ")}`);
      }
      return out.compiled;
    });
}

/**
 * Idempotent: safe to re-run. Must run as the admin/owner role (superuser or BYPASSRLS),
 * because it writes across tenants. The application role can never do this.
 */
export async function seed(adminUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  const db = drizzle(pool);
  const configs = loadSiteConfigs();
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  try {
    await db.transaction(async (tx) => {
      for (const [key, name] of Object.entries(roleNames)) {
        await tx.insert(s.roles).values({ key, name }).onConflictDoNothing({ target: s.roles.key });
      }
      for (const c of configs) {
        await tx.insert(s.sites).values({ id: c.siteId, slug: c.slug, name: c.name }).onConflictDoNothing({ target: s.sites.id });
      }
      // Reserved lab site for live Trust Console proofs. Hidden from site lists; no members.
      await tx.insert(s.sites).values({ id: TRUST_LAB_SITE_ID, slug: "trust-lab", name: "Trust Lab", isSystem: true }).onConflictDoNothing({ target: s.sites.id });
      for (const u of devUsers) {
        await tx
          .insert(s.users)
          .values({ id: u.id, email: u.email, displayName: u.name, passwordHash, isPlatformAdmin: u.platformAdmin })
          .onConflictDoNothing({ target: s.users.id });
      }
      const roleRows = await tx.select().from(s.roles);
      const roleId = new Map(roleRows.map((r) => [r.key, r.id]));
      const siteRows = await tx.select().from(s.sites);
      const siteId = new Map(siteRows.map((r) => [r.slug, r.id]));

      for (const u of devUsers) {
        for (const [slug, roleKeys] of Object.entries(u.memberships)) {
          for (const rk of roleKeys) {
            await tx
              .insert(s.userSiteRoles)
              .values({ userId: u.id, siteId: siteId.get(slug)!, roleId: roleId.get(rk)! })
              .onConflictDoNothing();
          }
        }
      }

      // Initial release (v1) and active pointer, only when the site has none.
      for (const c of configs) {
        const existing = await tx.select({ id: s.siteReleases.id }).from(s.siteReleases).where(eq(s.siteReleases.siteId, c.siteId)).limit(1);
        if (existing.length > 0) continue;
        const [release] = await tx
          .insert(s.siteReleases)
          .values({ siteId: c.siteId, version: 1, configuration: c, note: "Seed configuration (development demo)", publishedBy: devUsers[0].id })
          .returning({ id: s.siteReleases.id });
        await tx.insert(s.siteActiveReleases).values({ siteId: c.siteId, releaseId: release!.id, version: 1 });
        await tx.insert(s.auditEvents).values({ siteId: c.siteId, actorId: devUsers[0].id, action: "release.published", entityType: "site_release", entityId: release!.id, metadata: { version: 1, seed: true } });
      }

      // Demo stock with opening-balance ledger entries (so stock reconciles with the ledger).
      for (const [slug, items] of Object.entries(demoStock)) {
        const sid = siteId.get(slug)!;
        for (const it of items) {
          const found = await tx.select({ id: s.inventoryItems.id }).from(s.inventoryItems).where(and(eq(s.inventoryItems.siteId, sid), eq(s.inventoryItems.sku, it.sku)));
          if (found.length > 0) continue;
          const [row] = await tx
            .insert(s.inventoryItems)
            .values({ siteId: sid, sku: it.sku, name: it.name, unit: it.unit, onHand: it.qty, reorderLevel: it.reorder, extras: it.price === undefined ? {} : { price: it.price } })
            .returning({ id: s.inventoryItems.id });
          await tx.insert(s.stockLedger).values({ siteId: sid, itemId: row!.id, delta: it.qty, balanceAfter: it.qty, reason: "opening-balance", refType: "seed", refId: row!.id, actorId: devUsers[0].id });
        }
      }
      await tx.execute(sql`select 1`);
    });
  } finally {
    await pool.end();
  }
}
