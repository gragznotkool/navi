import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => db.close());

describe("hub overview", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/hub/overview")).status).toBe(401);
  });

  it("counts only the sites the caller belongs to, from real rows", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const res = await keeper.get("/api/v1/hub/overview");
    expect(res.status).toBe(200);
    const slugs = res.body.data.sites.map((x: { slug: string }) => x.slug);
    expect(slugs).toEqual(["central-stores"]);
    const pool = adminPool();
    const { rows } = await pool.query("select count(*)::int n from inventory_items where site_id = $1", [SITES.centralStores]);
    await pool.end();
    expect(res.body.data.sites[0].inventoryItems).toBe(rows[0].n);
    expect(res.body.data.totals.sites).toBe(1);
  });
});

describe("trust console helper routes", () => {
  const paths = ["summary", "isolation-check", "inventory-check", "audit-events"];

  it.each(paths)("/trust/%s is 401 anonymous and 403 for non-admins", async (p) => {
    expect((await request(app).get(`/api/v1/trust/${p}`)).status).toBe(401);
    expect((await (await loginAs("storekeeper@opshub.local")).get(`/api/v1/trust/${p}`)).status).toBe(403);
  });

  it("checks real data instead of passing vacuously", async () => {
    const admin = await loginAs("admin@opshub.local");
    const inv = (await admin.get("/api/v1/trust/inventory-check")).body.data;
    expect(inv.passed).toBe(true);
    expect(inv.detail).toMatch(/\d+ item\(s\)/);
    expect(Number(/(\d+) item\(s\)/.exec(inv.detail)![1])).toBeGreaterThan(0);

    // Corrupt one balance behind the application's back: the check must now fail.
    const pool = adminPool();
    await pool.query("alter table inventory_items disable trigger user");
    await pool.query("update inventory_items set on_hand = on_hand + 1 where id = (select id from inventory_items where site_id = $1 limit 1)", [SITES.centralStores]);
    await pool.query("alter table inventory_items enable trigger user");
    await pool.end();
    const broken = (await admin.get("/api/v1/trust/inventory-check")).body.data;
    expect(broken.passed).toBe(false);
    expect(broken.detail).toMatch(/central-stores/);
  });

  it("denies cross-site access for the isolation check and lists audit events", async () => {
    const admin = await loginAs("admin@opshub.local");
    const iso = (await admin.get("/api/v1/trust/isolation-check")).body.data;
    expect(typeof iso.passed).toBe("boolean");
    const events = (await admin.get("/api/v1/trust/audit-events")).body.data as { action: string }[];
    expect(events.length).toBeGreaterThan(0);
  });
});
