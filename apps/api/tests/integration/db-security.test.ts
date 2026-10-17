import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../../src/db/schema/index.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, freshDatabase, rejectsWith, SITES, USERS } from "../support/db.js";

let db: Database;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
});
afterAll(async () => {
  await db.close();
});

const ctx = (siteId: string, userId: string = USERS.admin) => ({ siteId, userId });

describe("migrations and seed", () => {
  it("seed is repeatable and creates no duplicates", async () => {
    const { seed } = await import("../../src/db/seeds/seed.js");
    const admin = adminPool();
    const count = async () => {
      const r = await admin.query(
        "select (select count(*) from users) + (select count(*) from site_releases) + (select count(*) from inventory_items) + (select count(*) from stock_ledger) + (select count(*) from user_site_roles) as n",
      );
      return Number(r.rows[0].n);
    };
    const before = await count();
    await seed(process.env.TEST_ADMIN_URL!);
    expect(await count()).toBe(before);
    await admin.end();
  });

  it("seeds three sites each with an active release", async () => {
    const rows = await db.withUser(USERS.admin, (tx) => tx.select().from(s.sites));
    expect(rows.map((r) => r.slug).sort()).toEqual(["central-stores", "distribution", "service-centre"]);
    for (const siteId of Object.values(SITES)) {
      const active = await db.withTenant(ctx(siteId), (tx) => tx.select().from(s.siteActiveReleases));
      expect(active).toHaveLength(1);
      expect(active[0]?.version).toBe(1);
    }
  });
});

describe("application role privileges", () => {
  it("is not superuser and does not bypass RLS", async () => {
    const r = await db.pool.query(
      "select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user",
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });

  it("cannot run DDL or delete rows", async () => {
    await rejectsWith(db.pool.query("create table sneaky (id int)"), /permission denied/i);
    await rejectsWith(
      db.withTenant(ctx(SITES.centralStores), (tx) => tx.execute(sql`delete from inventory_items`)),
    /permission denied/i);
  });

  it("cannot read or alter password hashes beyond SELECT/token_version", async () => {
    await rejectsWith(
      db.withoutTenant((tx) => tx.execute(sql`update users set password_hash = 'x'`)),
    /permission denied/i);
  });
});

describe("tenant isolation (RLS)", () => {
  it("missing tenant context returns zero rows for every tenant table", async () => {
    const tables = [
      "inventory_items",
      "stock_ledger",
      "requests",
      "approvals",
      "assignments",
      "consumption_records",
      "return_records",
      "repair_records",
      "site_releases",
      "site_active_releases",
      "site_drafts",
      "audit_events",
      "idempotency_keys",
      "user_site_roles",
      "sites",
    ];
    for (const t of tables) {
      const r = await db.withoutTenant((tx) => tx.execute(sql.raw(`select count(*)::int as n from ${t}`)));
      expect(r.rows[0]?.n, `${t} leaked rows without tenant context`).toBe(0);
    }
  });

  it("a site context only sees its own rows", async () => {
    const central = await db.withTenant(ctx(SITES.centralStores), (tx) => tx.select().from(s.inventoryItems));
    const dist = await db.withTenant(ctx(SITES.distribution), (tx) => tx.select().from(s.inventoryItems));
    expect(central.length).toBeGreaterThan(0);
    expect(dist.length).toBeGreaterThan(0);
    expect(central.every((i) => i.siteId === SITES.centralStores)).toBe(true);
    expect(dist.every((i) => i.siteId === SITES.distribution)).toBe(true);
    const ledger = await db.withTenant(ctx(SITES.centralStores), (tx) => tx.select().from(s.stockLedger));
    expect(ledger.every((l) => l.siteId === SITES.centralStores)).toBe(true);
  });

  it("cannot read another site's row by primary key", async () => {
    const [other] = await db.withTenant(ctx(SITES.distribution), (tx) => tx.select().from(s.inventoryItems).limit(1));
    const found = await db.withTenant(ctx(SITES.centralStores), (tx) =>
      tx.select().from(s.inventoryItems).where(eq(s.inventoryItems.id, other!.id)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot write a row into another site (WITH CHECK)", async () => {
    await rejectsWith(
      db.withTenant(ctx(SITES.centralStores), (tx) =>
        tx.insert(s.inventoryItems).values({ siteId: SITES.distribution, sku: "EVIL-1", name: "x", onHand: 0 }),
      ),
    /row-level security/i);
  });

  it("cannot update another site's rows (silently affects zero rows)", async () => {
    const r = await db.withTenant(ctx(SITES.centralStores), (tx) =>
      tx.update(s.inventoryItems).set({ name: "hijacked" }).where(eq(s.inventoryItems.siteId, SITES.distribution)).returning(),
    );
    expect(r).toHaveLength(0);
  });

  it("a user only sees sites they belong to", async () => {
    const storekeeper = await db.withUser(USERS.storekeeper, (tx) => tx.select().from(s.sites));
    expect(storekeeper.map((x) => x.slug)).toEqual(["central-stores"]);
    const memberships = await db.withUser(USERS.storekeeper, (tx) => tx.select().from(s.userSiteRoles));
    expect(memberships.every((m) => m.userId === USERS.storekeeper)).toBe(true);
  });

  it("rejects non-UUID tenant identifiers before touching the database", async () => {
    await rejectsWith(db.withTenant({ siteId: "1' or '1'='1", userId: USERS.admin }, async () => 1), );
  });

  it("does not leak tenant context across pooled connections", async () => {
    const single = appDb(1); // one connection => guaranteed reuse
    try {
      const a = await single.withTenant(ctx(SITES.centralStores), (tx) => tx.select().from(s.inventoryItems));
      expect(a.length).toBeGreaterThan(0);
      // Next unit of work on the SAME connection with no context must see nothing.
      const leaked = await single.withoutTenant((tx) => tx.select().from(s.inventoryItems));
      expect(leaked).toHaveLength(0);
      const setting = await single.pool.query("select current_setting('app.current_site_id', true) as v");
      expect(setting.rows[0].v ?? "").toBe("");
      // A failing transaction must not leave context behind either.
      await rejectsWith(
        single.withTenant(ctx(SITES.distribution), async () => {
          throw new Error("boom");
        }),
      "boom");
      expect(await single.withoutTenant((tx) => tx.select().from(s.inventoryItems))).toHaveLength(0);
    } finally {
      await single.close();
    }
  });

  it("audit events are readable only within their site, but platform events can be written", async () => {
    await db.withoutTenant((tx) =>
      tx.insert(s.auditEvents).values({ siteId: null, action: "auth.login-failed", entityType: "user" }),
    );
    const central = await db.withTenant(ctx(SITES.centralStores), (tx) => tx.select().from(s.auditEvents));
    expect(central.every((e) => e.siteId === SITES.centralStores)).toBe(true);
    await rejectsWith(
      db.withTenant(ctx(SITES.centralStores), (tx) =>
        tx.insert(s.auditEvents).values({ siteId: SITES.distribution, action: "x", entityType: "y" }),
      ),
    /row-level security/i);
  });
});

describe("database-level invariants", () => {
  it("rejects negative stock via CHECK constraint", async () => {
    await rejectsWith(
      db.withTenant(ctx(SITES.centralStores), (tx) =>
        tx.update(s.inventoryItems).set({ onHand: -1 }).where(eq(s.inventoryItems.siteId, SITES.centralStores)),
      ),
    /inventory_items_on_hand_nonneg|check constraint/i);
  });

  it("ledger, audit events and releases are append-only: app role lacks privileges, and triggers stop even the owner", async () => {
    const mutations = [
      "update stock_ledger set delta = 999",
      "update audit_events set action = 'tampered'",
      "update site_releases set note = 'edited'",
      "delete from stock_ledger",
    ];
    const admin = adminPool();
    try {
      for (const q of mutations) {
        await rejectsWith(
          db.withTenant(ctx(SITES.centralStores), (tx) => tx.execute(sql.raw(q))),
          /permission denied/i,
        );
        await rejectsWith(admin.query(q), /append-only|immutable/i);
      }
    } finally {
      await admin.end();
    }
  });

  it("an assignment cannot exist without an approved request", async () => {
    const admin = adminPool();
    try {
      const [item] = (await admin.query("select id from inventory_items where site_id = $1 limit 1", [SITES.distribution])).rows;
      const req = (
        await admin.query(
          "insert into requests (site_id, status, requested_by, release_version) values ($1,'submitted',$2,1) returning id",
          [SITES.distribution, USERS.dispatcher],
        )
      ).rows[0];
      await admin.query(
        "insert into request_lines (site_id, request_id, item_id, quantity) values ($1,$2,$3,1)",
        [SITES.distribution, req.id, item.id],
      );
      await rejectsWith(
        admin.query(
          "insert into assignments (site_id, request_id, quantity, assigned_by) values ($1,$2,1,$3)",
          [SITES.distribution, req.id, USERS.dispatcher],
        ),
      /assignments_requires_approval_fk/);
    } finally {
      await admin.end();
    }
  });

  it("cross-site references are rejected by composite foreign keys", async () => {
    const admin = adminPool();
    try {
      const [centralItem] = (await admin.query("select id from inventory_items where site_id = $1 limit 1", [SITES.centralStores])).rows;
      const req = (
        await admin.query(
          "insert into requests (site_id, status, requested_by, release_version) values ($1,'submitted',$2,1) returning id",
          [SITES.distribution, USERS.dispatcher],
        )
      ).rows[0];
      await rejectsWith(
        admin.query(
          "insert into request_lines (site_id, request_id, item_id, quantity) values ($1,$2,$3,1)",
          [SITES.distribution, req.id, centralItem.id],
        ),
      /request_lines_item_same_site_fk/);
    } finally {
      await admin.end();
    }
  });

  it("stock reconciles with the ledger for seeded data", async () => {
    const rows = await db.withTenant(ctx(SITES.centralStores), (tx) => tx.execute(sql`select * from stock_reconciliation`));
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.reconciled === true)).toBe(true);
  });
});
