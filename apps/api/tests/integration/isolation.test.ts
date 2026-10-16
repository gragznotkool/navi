import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { manifest } from "../../src/routes/manifest.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES, USERS } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  return agent;
}

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

const SITE_ROUTES = () => manifest.filter((r) => r.path.includes("/sites/:siteId"));
type Method = "get" | "post" | "put" | "patch";
const verb = (m: string) => m.toLowerCase() as Method;

describe("every /sites/:siteId route enforces membership", () => {
  it("covers a meaningful number of routes (guards against the manifest silently emptying)", () => {
    expect(SITE_ROUTES().length).toBeGreaterThanOrEqual(20);
  });

  it("returns 404 for a user who is not a member of the site, on every route and method", async () => {
    // dispatcher belongs to distribution only; probe central-stores and service-centre.
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const failures: string[] = [];
    for (const site of [SITES.centralStores, SITES.serviceCentre]) {
      for (const r of SITE_ROUTES()) {
        const path = r.path.replace(":siteId", site).replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-0000000000ff");
        const res = await dispatcher[verb(r.method)](path).set(H).set("Idempotency-Key", "isolation-probe-0001").send({});
        if (res.status !== 404) failures.push(`${r.method} ${r.path} on ${site} → ${res.status}`);
        expect(JSON.stringify(res.body)).not.toMatch(/central|service centre|BRG-6204/i);
      }
    }
    expect(failures).toEqual([]);
  });

  it("returns 401 on every route without a session", async () => {
    const failures: string[] = [];
    for (const r of SITE_ROUTES()) {
      const path = r.path.replace(":siteId", SITES.distribution).replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-0000000000ff");
      const res = await request(app)[verb(r.method)](path).set(H).send({});
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("never serves another site's records by id (404, or 403 when the role lacks the permission)", async () => {
    // A member of distribution asks distribution's routes for central-stores' ids.
    const pool = adminPool();
    const item = (await pool.query("select id from inventory_items where site_id = $1 limit 1", [SITES.centralStores])).rows[0];
    const req = (await pool.query("insert into requests (site_id, status, requested_by, release_version) values ($1,'submitted',$2,1) returning id", [SITES.centralStores, USERS.storekeeper])).rows[0];
    await pool.query("insert into request_lines (site_id, request_id, item_id, quantity) values ($1,$2,$3,1)", [SITES.centralStores, req.id, item.id]);
    const release = (await pool.query("select id from site_releases where site_id = $1 limit 1", [SITES.centralStores])).rows[0];
    await pool.end();

    const ids: Record<string, string> = { itemId: item.id, requestId: req.id, releaseId: release.id };
    const admin = await loginAs("admin@opshub.local"); // member of ALL three sites, platform admin
    const failures: string[] = [];
    for (const r of SITE_ROUTES().filter((x) => x.method === "GET" && /:(itemId|requestId|releaseId)/.test(x.path))) {
      const path = r.path.replace(":siteId", SITES.distribution).replace(/:([A-Za-z]+)/g, (_m, k: string) => ids[k] ?? "00000000-0000-4000-8000-0000000000ff");
      const res = await admin.get(path);
      if (![403, 404].includes(res.status)) failures.push(`GET ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});
