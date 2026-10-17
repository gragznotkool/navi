import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropSchema } from "../../src/db/reset.js";
import { runMigrations } from "../../src/db/migrate.js";
import { assertLedgerBalance } from "../../src/db/seeds/demo-data.js";
import { seed } from "../../src/db/seeds/seed.js";
import { adminPool, adminUrl, appUrl, SITES } from "../support/db.js";

describe("120-request demo dataset", () => {
  let pool: pg.Pool;
  let elapsedMs = 0;

  beforeAll(async () => {
    const t0 = performance.now();
    await dropSchema(adminUrl());
    await runMigrations(adminUrl(), appUrl());
    await seed(adminUrl(), { demoData: true });
    elapsedMs = performance.now() - t0;
    pool = adminPool();
  });
  afterAll(async () => pool.end());

  it("creates exactly 34 Service Centre and 86 Distribution requests across all lifecycle states", async () => {
    const r = await pool.query("select site_id, status, count(*)::int n from requests group by 1,2");
    const by = (site: string) => Object.fromEntries(r.rows.filter((x) => x.site_id === site).map((x) => [x.status, x.n]));
    expect(by(SITES.serviceCentre)).toEqual({ submitted: 6, approved: 5, assigned: 7, fulfilled: 12, rejected: 4 });
    expect(by(SITES.distribution)).toEqual({ submitted: 14, approved: 12, assigned: 18, fulfilled: 34, rejected: 8 });
  });

  it("has 15+ demo SKUs and a ledger that balances for every SKU", async () => {
    const n = await pool.query("select count(*)::int n from inventory_items where unit_cost > 0");
    expect(n.rows[0].n).toBeGreaterThanOrEqual(15);
    expect(await assertLedgerBalance(pool)).toBeGreaterThanOrEqual(15);
  });

  it("assertLedgerBalance fails on tampered stock", async () => {
    await pool.query("update inventory_items set on_hand = on_hand + 1 where sku = 'BRG-6204'");
    await expect(assertLedgerBalance(pool)).rejects.toThrow(/Ledger imbalance.*BRG-6204/);
    await pool.query("update inventory_items set on_hand = on_hand - 1 where sku = 'BRG-6204'");
  });

  it("ties companion records to each request", async () => {
    const q = async (sql: string) => (await pool.query(sql)).rows[0].n as number;
    expect(await q("select count(*)::int n from approvals")).toBe(120 - 20);
    expect(await q("select count(*)::int n from assignments")).toBe(7 + 12 + 18 + 34);
    // fulfilled requests consumed exactly what was assigned
    expect(await q("select count(*)::int n from assignments a join requests r on r.id=a.request_id where r.status='fulfilled' and a.quantity <> (select coalesce(sum(quantity),0) from consumption_records c where c.assignment_id=a.id)")).toBe(0);
    expect(await q("select count(*)::int n from audit_events where action='request.submitted'")).toBe(120);
  });

  it("is deterministic and idempotent", async () => {
    const before = (await pool.query("select md5(string_agg(r.id::text || rl.quantity || r.status, ',' order by r.id)) h from requests r join request_lines rl on rl.request_id = r.id")).rows[0].h;
    await seed(adminUrl(), { demoData: true });
    const after = (await pool.query("select md5(string_agg(r.id::text || rl.quantity || r.status, ',' order by r.id)) h, count(distinct r.id)::int n from requests r join request_lines rl on rl.request_id = r.id")).rows[0];
    expect(after.h).toBe(before);
    expect(after.n).toBe(120);
  });

  it("resets and seeds in well under 5 seconds", () => {
    expect(elapsedMs).toBeLessThan(5000);
  });
});
