import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SyncResult } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
const base = `/api/v1/sites/${SITES.distribution}`;
let db: Database;
let app: Express;
let itemId: string;
let seq = 0;
const key = (label = "op") => `sync-${label}-${Date.now()}-${++seq}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = () => loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
async function loginAs(email: string, a: Express = app) {
  const agent = request.agent(a);
  expect((await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD })).status).toBe(200);
  return agent;
}
const sync = (agent: request.Agent, ops: unknown[], site = base) => agent.post(`${site}/sync`).set(H).send({ ops });
const results = (res: request.Response) => res.body.data.results as SyncResult[];
async function q(sql: string, params: unknown[] = []) {
  const pool = adminPool();
  try {
    return (await pool.query(sql, params)).rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}
const requestCount = async () => (await q("select count(*)::int n from requests where site_id = $1", [SITES.distribution]))[0]!.n as number;
const ledgerCount = async () => (await q("select count(*)::int n from stock_ledger where site_id = $1", [SITES.distribution]))[0]!.n as number;
const onHand = async () => (await q("select on_hand from inventory_items where id = $1", [itemId]))[0]!.on_hand as number;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  app = createApp({ db, env: env(), loginRateLimit: 1000 });
  itemId = (await q("select id from inventory_items where site_id = $1 order by sku limit 1", [SITES.distribution]))[0]!.id as string;
});
afterAll(async () => {
  await db.close();
});

describe("replaying queued offline operations", () => {
  it("applies a queued request once; replaying the same key (any number of times) changes nothing", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const before = { requests: await requestCount(), ledger: await ledgerCount(), stock: await onHand() };
    const op = { key: key("req"), type: "request.create", payload: { lines: [{ itemId, quantity: 2 }], note: "made offline" } };

    const first = await sync(dispatcher, [op]);
    expect(first.status).toBe(200);
    expect(results(first)).toEqual([{ key: op.key, status: "applied" }]);
    expect(await requestCount()).toBe(before.requests + 1);

    for (let i = 0; i < 3; i++) expect(results(await sync(dispatcher, [op]))).toEqual([{ key: op.key, status: "duplicate" }]);
    expect(await requestCount()).toBe(before.requests + 1); // still exactly one
    expect(await ledgerCount()).toBe(before.ledger); // a request never moves stock
    expect(await onHand()).toBe(before.stock);
    expect((await q("select note, status from requests where site_id = $1 order by created_at desc limit 1", [SITES.distribution]))[0]).toMatchObject({ note: "made offline", status: "submitted" });
  });

  it("two simultaneous syncs of the same queue apply it once", async () => {
    const a = await loginAs("dispatcher@opshub.local");
    const b = await loginAs("dispatcher@opshub.local");
    const before = await requestCount();
    const op = { key: key("race"), type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } };
    const [r1, r2] = await Promise.all([sync(a, [op]), sync(b, [op])]);
    expect([results(r1)[0]!.status, results(r2)[0]!.status].sort()).toEqual(["applied", "duplicate"]);
    expect(await requestCount()).toBe(before + 1);
  });

  it("the same key twice inside one batch applies once", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const before = await requestCount();
    const op = { key: key("twice"), type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } };
    expect(results(await sync(dispatcher, [op, op])).map((r) => r.status)).toEqual(["applied", "duplicate"]);
    expect(await requestCount()).toBe(before + 1);
  });

  it("reuse of a key for DIFFERENT content is rejected, not applied", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const k = key("reuse");
    await sync(dispatcher, [{ key: k, type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } }]);
    const before = await requestCount();
    const r = results(await sync(dispatcher, [{ key: k, type: "request.create", payload: { lines: [{ itemId, quantity: 5 }] } }]))[0]!;
    expect(r).toMatchObject({ status: "rejected", code: "idempotency_key_reuse" });
    expect(await requestCount()).toBe(before);
  });

  it("reports each operation separately: a bad one never blocks the good ones around it", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const before = await requestCount();
    const good1 = { key: key("g1"), type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } };
    const bad = { key: key("bad"), type: "request.create", payload: { lines: [{ itemId: "00000000-0000-4000-8000-0000000000ff", quantity: 1 }] } };
    const invalid = { key: key("inv"), type: "request.create", payload: { lines: [] } };
    const good2 = { key: key("g2"), type: "request.create", payload: { lines: [{ itemId, quantity: 3 }] } };
    const out = results(await sync(dispatcher, [good1, bad, invalid, good2]));
    expect(out.map((r) => r.status)).toEqual(["applied", "rejected", "rejected", "applied"]);
    expect(out[1]).toMatchObject({ code: "not_found" });
    expect(out[2]).toMatchObject({ code: "invalid", reason: "Add at least one item" });
    expect(await requestCount()).toBe(before + 2);
  });

  it("a rejected operation can be retried later with the same key if the cause is fixed (nothing was consumed)", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const k = key("retry");
    const op = { key: k, type: "request.create", payload: { lines: [{ itemId: "00000000-0000-4000-8000-0000000000fe", quantity: 1 }] } };
    expect(results(await sync(dispatcher, [op]))[0]!.status).toBe("rejected");
    expect((await q("select 1 from idempotency_keys where key = $1", [k])).length).toBe(0);
    const fixed = { ...op, payload: { lines: [{ itemId, quantity: 1 }] } };
    expect(results(await sync(dispatcher, [fixed]))[0]!.status).toBe("applied");
  });
});

describe("what may not be done offline", () => {
  it("refuses stock-changing and unknown operations with an explanation", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const before = { ledger: await ledgerCount(), stock: await onHand() };
    const out = results(
      await sync(dispatcher, [
        { key: key("a"), type: "assignment.create", payload: { requestId: "00000000-0000-4000-8000-000000000001" } },
        { key: key("b"), type: "inventory.import", payload: {} },
        { key: key("c"), type: "inventory.adjust", payload: { itemId, delta: -5 } },
        { key: key("d"), type: "users.delete", payload: {} },
        { key: key("e"), type: "__proto__", payload: {} },
      ]),
    );
    expect(out.map((r) => r.code)).toEqual(["blocked_offline", "blocked_offline", "blocked_offline", "unsupported", "unsupported"]);
    expect(out[0]!.reason).toMatch(/needs a live connection/);
    expect(await ledgerCount()).toBe(before.ledger);
    expect(await onHand()).toBe(before.stock);
  });

  it("re-checks permission at sync time: a role that cannot create requests cannot smuggle one in", async () => {
    const approver = await loginAs("approver@opshub.local"); // approvers have no request:create here
    const before = await requestCount();
    const r = results(await sync(approver, [{ key: key("perm"), type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } }]))[0]!;
    expect(r).toMatchObject({ status: "rejected", code: "forbidden" });
    expect(await requestCount()).toBe(before);
  });
});

describe("consumption recorded offline", () => {
  it("applies once, enforces the remaining quantity, and rejects what no longer fits", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const approver = await loginAs("approver@opshub.local");
    const created = await dispatcher.post(`${base}/requests`).set(H).send({ lines: [{ itemId, quantity: 4 }] });
    expect(created.status).toBe(201);
    const reqId = created.body.data.id as string;
    expect((await approver.post(`${base}/requests/${reqId}/decision`).set(H).send({ decision: "approved" })).status).toBe(200);
    const assigned = await dispatcher.post(`${base}/assignments`).set(H).set("idempotency-key", key("assign")).send({ requestId: reqId });
    expect(assigned.status).toBe(201);
    const assignmentId = assigned.body.data.id as string;

    const use3 = { key: key("use"), type: "consumption.record", payload: { assignmentId, quantity: 3 } };
    expect(results(await sync(dispatcher, [use3]))[0]!.status).toBe("applied");
    expect(results(await sync(dispatcher, [use3]))[0]!.status).toBe("duplicate");
    expect((await q("select coalesce(sum(quantity),0)::int n from consumption_records where assignment_id = $1", [assignmentId]))[0]!.n).toBe(3);

    const tooMuch = results(await sync(dispatcher, [{ key: key("over"), type: "consumption.record", payload: { assignmentId, quantity: 2 } }]))[0]!;
    expect(tooMuch).toMatchObject({ status: "rejected", code: "over_consumption" });
    expect(tooMuch.reason).toMatch(/Only 1 unit\(s\) remain/);
    const ghost = results(await sync(dispatcher, [{ key: key("ghost"), type: "consumption.record", payload: { assignmentId: "00000000-0000-4000-8000-0000000000ee", quantity: 1 } }]))[0]!;
    expect(ghost).toMatchObject({ status: "rejected", code: "not_found" });
    expect(results(await sync(dispatcher, [{ key: key("last"), type: "consumption.record", payload: { assignmentId, quantity: 1 } }]))[0]!.status).toBe("applied");
    expect((await q("select status from requests where id = $1", [reqId]))[0]!.status).toBe("fulfilled");
  });
});

describe("access and limits", () => {
  it("needs a session and membership of this site", async () => {
    const op = [{ key: key("acl"), type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } }];
    expect((await request(app).post(`${base}/sync`).set(H).send({ ops: op })).status).toBe(401);
    const keeper = await loginAs("storekeeper@opshub.local"); // member of Central Stores only
    expect((await sync(keeper, op)).status).toBe(404);
  });

  it("validates the envelope: at least one and at most 50 operations, a usable key, a body that is an object", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local");
    expect((await sync(dispatcher, [])).status).toBe(400);
    expect((await sync(dispatcher, Array.from({ length: 51 }, () => ({ key: key("many"), type: "request.create", payload: {} })))).status).toBe(400);
    expect((await sync(dispatcher, [{ key: "short", type: "request.create", payload: {} }])).status).toBe(400);
    expect((await dispatcher.post(`${base}/sync`).send({ ops: [] })).status).toBe(403); // CSRF header required
  });

  it("an expired access token is refused; after a refresh the same queue syncs exactly once", async () => {
    const short = createApp({ db, env: { ...env(), JWT_EXPIRES_IN_SECONDS: 3 }, loginRateLimit: 1000 });
    const dispatcher = await loginAs("dispatcher@opshub.local", short);
    const op = { key: key("expiry"), type: "request.create", payload: { lines: [{ itemId, quantity: 1 }] } };
    await sleep(4200);
    const before = await requestCount();
    expect((await sync(dispatcher, [op])).status).toBe(401); // nothing applied while the token is dead
    expect(await requestCount()).toBe(before);
    expect((await dispatcher.post("/api/v1/auth/refresh").set(H)).status).toBe(200);
    expect(results(await sync(dispatcher, [op]))[0]!.status).toBe("applied");
    expect(results(await sync(dispatcher, [op]))[0]!.status).toBe("duplicate");
    expect(await requestCount()).toBe(before + 1);
  });
});
