import request from "supertest";
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteConfiguration } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { PUBLIC_INTAKE_USER_ID } from "../../src/public/intake.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
const env = () => loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
let db: Database;
let app: Express;
const dist = `/api/v1/sites/${SITES.distribution}`;
const post = (slug: string, body: unknown) => request(app).post(`/api/public/${slug}/requests`).send(body as object);

async function loginAs(email: string) {
  const agent = request.agent(app);
  expect((await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD })).status).toBe(200);
  return agent;
}
async function sql_(q: string, params: unknown[] = []) {
  const pool = adminPool();
  try {
    return (await pool.query(q, params)).rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}
const publicRequests = async () => (await sql_("select id, status, requested_by, note, release_version from requests where requested_by = $1 order by created_at", [PUBLIC_INTAKE_USER_ID])) as { id: string; status: string; requested_by: string; note: string; release_version: number }[];

/** Publishes a new release of Distribution with the Request module's publicIntake flag set. */
async function setIntake(enabled: boolean | undefined) {
  const admin = await loginAs("admin@opshub.local");
  const live = (await admin.get(`${dist}/config`)).body.data as { version: number; configuration: SiteConfiguration };
  const cfg = JSON.parse(JSON.stringify(live.configuration)) as SiteConfiguration;
  const node = cfg.modules.nodes.find((n) => n.moduleType === "request")!;
  if (enabled === undefined) delete node.config.publicIntake;
  else node.config.publicIntake = enabled;
  const res = await admin.post(`${dist}/releases/publish`).set(H).send({ baseVersion: live.version, configuration: cfg });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { version: number };
}

let sku: string;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  app = createApp({ db, env: env(), loginRateLimit: 1000, publicRateLimit: 1000 });
  sku = (await sql_("select sku from inventory_items where site_id = $1 order by sku limit 1", [SITES.distribution]))[0]!.sku as string;
});
afterAll(async () => {
  await db.close();
});

describe("public intake is off unless the active release turns it on", () => {
  it("answers 404 for a site that has not enabled it, an unknown site and the system site, identically", async () => {
    const body = { lines: [{ sku, quantity: 1 }] };
    const results = await Promise.all([post("distribution", body), post("no-such-site", body), post("trust-lab", body), post("central-stores", body)]);
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("not_found");
    }
    expect(new Set(results.map((r) => JSON.stringify({ ...r.body, error: { ...r.body.error, requestId: undefined } }))).size).toBe(1); // nothing to tell them apart
    expect(await publicRequests()).toEqual([]);
  });

  it("the new setting is described in plain English before it is published", async () => {
    const admin = await loginAs("admin@opshub.local");
    const live = (await admin.get(`${dist}/config`)).body.data as { version: number; configuration: SiteConfiguration };
    const cfg = JSON.parse(JSON.stringify(live.configuration)) as SiteConfiguration;
    cfg.modules.nodes.find((n) => n.moduleType === "request")!.config.publicIntake = true;
    const impact = await admin.post(`${dist}/releases/impact`).set(H).send({ baseVersion: live.version, configuration: cfg });
    expect(impact.body.data.sentences.join(" ")).toMatch(/submit requests without signing in/);
  });
});

describe("once enabled", () => {
  beforeAll(async () => {
    await setIntake(true);
  });

  it("accepts a whitelisted request without a session, stores it as 'submitted', and returns nothing about it", async () => {
    const res = await post("distribution", { lines: [{ sku, quantity: 3 }], note: "Need these for the Tuesday run" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { accepted: true } });
    expect(res.headers["set-cookie"]).toBeUndefined(); // no session is created
    const rows = await publicRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "submitted", requested_by: PUBLIC_INTAKE_USER_ID });
    expect(rows[0]!.note).toBe("Public request: Need these for the Tuesday run");
    expect((await sql_("select 1 from audit_events where action = 'request.submitted-public' and site_id = $1", [SITES.distribution])).length).toBe(1);
  });

  it("the request then goes through the normal approval like any other", async () => {
    const approver = await loginAs("approver@opshub.local");
    const list = (await approver.get(`${dist}/requests`)).body.data.items as { id: string; status: string }[];
    const mine = (await publicRequests())[0]!;
    expect(list.find((r) => r.id === mine.id)?.status).toBe("submitted");
    const res = await approver.post(`${dist}/requests/${mine.id}/decision`).set(H).send({ decision: "approved" });
    expect(res.status).toBe(200);
  });

  it.each([
    ["an unknown field", { lines: [{ sku, quantity: 1 }], status: "approved" }],
    ["an unknown field on a line", { lines: [{ sku, quantity: 1, itemId: "x" }] }],
    ["a requestedBy override", { lines: [{ sku, quantity: 1 }], requestedBy: "10000000-0000-4000-8000-000000000001" }],
    ["no lines", { lines: [] }],
    ["too many lines", { lines: Array.from({ length: 6 }, (_, i) => ({ sku: `S${i}`, quantity: 1 })) }],
    ["quantity zero", { lines: [{ sku, quantity: 0 }] }],
    ["quantity over the cap", { lines: [{ sku, quantity: 101 }] }],
    ["a fractional quantity", { lines: [{ sku, quantity: 1.5 }] }],
    ["a quantity sent as text", { lines: [{ sku, quantity: "5" }] }],
    ["a malformed sku", { lines: [{ sku: "a; drop table requests", quantity: 1 }] }],
    ["an over-long note", { lines: [{ sku, quantity: 1 }], note: "x".repeat(201) }],
    ["a non-object body", "hello"],
    ["an array body", []],
  ])("rejects %s with a client error and stores nothing", async (_label, body) => {
    const before = (await publicRequests()).length;
    const res = await request(app).post("/api/public/distribution/requests").set("content-type", "application/json").send(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect((await publicRequests()).length).toBe(before);
  });

  it("an item that does not exist, or the same item twice, is refused without detail", async () => {
    const before = (await publicRequests()).length;
    const a = await post("distribution", { lines: [{ sku: "NOPE-999", quantity: 1 }] });
    expect(a.status).toBe(422);
    expect(a.body.error.message).toBe("One of the items is not available.");
    const b = await post("distribution", { lines: [{ sku, quantity: 1 }, { sku, quantity: 2 }] });
    expect(b.status).toBe(422);
    expect((await publicRequests()).length).toBe(before);
  });

  it("silently drops a request whose hidden honeypot field is filled", async () => {
    const before = (await publicRequests()).length;
    const res = await post("distribution", { lines: [{ sku, quantity: 1 }], website: "http://spam.example" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { accepted: true } });
    expect((await publicRequests()).length).toBe(before);
  });

  it("cannot be used to read anything, and does not accept other methods", async () => {
    expect((await request(app).get("/api/public/distribution/requests")).status).toBe(404);
    expect((await request(app).get("/api/public/distribution")).status).toBe(404);
    expect((await request(app).put("/api/public/distribution/requests").send({})).status).toBe(404);
    expect((await request(app).delete("/api/public/distribution/requests").send({})).status).toBe(404);
  });

  it("never lets another site's items be requested through this site's address", async () => {
    const other = (await sql_("select sku from inventory_items where site_id = $1 limit 1", [SITES.centralStores]))[0]!.sku as string;
    if (other === sku) return;
    const res = await post("distribution", { lines: [{ sku: other, quantity: 1 }] });
    expect(res.status).toBe(422);
  });

  it("the system account cannot be signed in to", async () => {
    const res = await request(app).post("/api/v1/auth/login").set(H).send({ email: "public-intake@system.invalid", password: DEV_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("turning it off in a new release closes the door again, and a rollback restores the previous state", async () => {
    const before = (await publicRequests()).length;
    await setIntake(false);
    expect((await post("distribution", { lines: [{ sku, quantity: 1 }] })).status).toBe(404);
    await setIntake(undefined);
    expect((await post("distribution", { lines: [{ sku, quantity: 1 }] })).status).toBe(404);
    expect((await publicRequests()).length).toBe(before);
    await setIntake(true);
    expect((await post("distribution", { lines: [{ sku, quantity: 1 }] })).status).toBe(202);
  });
});

describe("limits and database enforcement", () => {
  it("rate limits submissions", async () => {
    const limited = createApp({ db, env: env(), loginRateLimit: 1000, publicRateLimit: 2 });
    const send = () => request(limited).post("/api/public/distribution/requests").send({ lines: [{ sku, quantity: 1 }] });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("rate_limited");
  });

  it("the database exposes a site row to the application role only inside a transaction that names it", async () => {
    const none = await db.withoutTenant(async (tx) => (await tx.execute<{ n: number }>(sql`select count(*)::int n from sites where slug = 'distribution'`)).rows[0]!.n);
    expect(none).toBe(0);
    const one = await db.withoutTenant(async (tx) => {
      await tx.execute(sql`select set_config('app.public_slug', 'distribution', true)`);
      return (await tx.execute<{ n: number }>(sql`select count(*)::int n from sites`)).rows[0]!.n;
    });
    expect(one).toBe(1); // exactly the named site, not the others
    const system = await db.withoutTenant(async (tx) => {
      await tx.execute(sql`select set_config('app.public_slug', 'trust-lab', true)`);
      return (await tx.execute<{ n: number }>(sql`select count(*)::int n from sites`)).rows[0]!.n;
    });
    expect(system).toBe(0); // the reserved system site can never be resolved publicly
  });
});
