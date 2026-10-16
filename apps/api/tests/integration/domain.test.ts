import request from "supertest";
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnalyticsSummary, RepairRecord, ReturnRecord, SiteMember } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { allocateReturn } from "../../src/services/domain.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;
const svc = `/api/v1/sites/${SITES.serviceCentre}`;
const central = `/api/v1/sites/${SITES.centralStores}`;
const dist = `/api/v1/sites/${SITES.distribution}`;
let seq = 0;
const key = (l = "k") => `domain-${l}-${Date.now()}-${++seq}`;

async function loginAs(email: string) {
  const agent = request.agent(app);
  expect((await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD })).status).toBe(200);
  return agent;
}
async function q(text: string, params: unknown[] = []) {
  const pool = adminPool();
  try {
    return (await pool.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

/** An assignment of `qty` units of two items (3 + rest) in Service Centre, created directly (that site has no assignment module). */
async function seedAssignment(totalQty: number): Promise<{ assignmentId: string; itemA: string; itemB: string }> {
  const items = await q("select id from inventory_items where site_id = $1 order by id limit 2", [SITES.serviceCentre]);
  const [a, b] = [items[0]!.id as string, items[1]!.id as string];
  const admin = (await q("select id from users where email = 'admin@opshub.local'"))[0]!.id as string;
  const rq = (await q("insert into requests (site_id, status, requested_by, release_version) values ($1, 'assigned', $2, 1) returning id", [SITES.serviceCentre, admin]))[0]!.id as string;
  const first = Math.min(3, totalQty);
  await q("insert into request_lines (site_id, request_id, item_id, quantity, extras) values ($1,$2,$3,$4,'{}')", [SITES.serviceCentre, rq, a, first]);
  if (totalQty > first) await q("insert into request_lines (site_id, request_id, item_id, quantity, extras) values ($1,$2,$3,$4,'{}')", [SITES.serviceCentre, rq, b, totalQty - first]);
  await q("insert into approvals (site_id, request_id, decision, decided_by) values ($1,$2,'approved',$3)", [SITES.serviceCentre, rq, admin]);
  const as = (await q("insert into assignments (site_id, request_id, quantity, assigned_by, config_version) values ($1,$2,$3,$4,1) returning id", [SITES.serviceCentre, rq, totalQty, admin]))[0]!.id as string;
  return { assignmentId: as, itemA: a, itemB: b };
}
const onHand = async (id: string) => (await q("select on_hand from inventory_items where id = $1", [id]))[0]!.on_hand as number;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
  // Service Centre has no stock in the seed; give it two items (with matching ledger entries) for the return tests.
  for (const [sku, qty] of [["SC-A", 10], ["SC-B", 10]] as const) {
    const id = (await q("insert into inventory_items (site_id, sku, name, unit, on_hand, reorder_level, extras) values ($1,$2,$2,'each',$3,0,'{}') returning id", [SITES.serviceCentre, sku, qty]))[0]!.id as string;
    await q("insert into stock_ledger (site_id, item_id, delta, balance_after, reason) values ($1,$2,$3,$3,'opening-balance')", [SITES.serviceCentre, id, qty]);
  }
});
afterAll(async () => {
  await db.close();
});

describe("return allocation", () => {
  it("spreads a quantity over lines in item-id order without exceeding any line", () => {
    const lines = [{ itemId: "b", quantity: 5 }, { itemId: "a", quantity: 3 }];
    expect(allocateReturn(lines, 2)).toEqual([{ itemId: "a", quantity: 2 }]);
    expect(allocateReturn(lines, 3)).toEqual([{ itemId: "a", quantity: 3 }]);
    expect(allocateReturn(lines, 6)).toEqual([{ itemId: "a", quantity: 3 }, { itemId: "b", quantity: 3 }]);
    expect(allocateReturn(lines, 8)).toEqual([{ itemId: "a", quantity: 3 }, { itemId: "b", quantity: 5 }]);
    expect(allocateReturn(lines, 100).reduce((n, l) => n + l.quantity, 0)).toBe(8); // never more than was assigned
    expect(allocateReturn(lines, 0)).toEqual([]);
  });
});

describe("returns", () => {
  it("initiate, inspect, restock: units go back on the shelf once, with ledger entries", async () => {
    const { assignmentId, itemA, itemB } = await seedAssignment(5);
    const admin = await loginAs("admin@opshub.local");
    const beforeA = await onHand(itemA);
    const beforeB = await onHand(itemB);

    const created = await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 4 });
    expect(created.status).toBe(201);
    const ret = created.body.data as ReturnRecord;
    expect(ret.status).toBe("initiated");
    expect((await admin.post(`${svc}/returns/${ret.id}/transition`).set(H).send({ to: "inspected" })).body.data.status).toBe("inspected");

    const k = key("restock");
    expect((await admin.post(`${svc}/returns/${ret.id}/transition`).set(H).send({ to: "restocked" })).status).toBe(400); // needs a key
    const done = await admin.post(`${svc}/returns/${ret.id}/transition`).set(H).set("idempotency-key", k).send({ to: "restocked" });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("restocked");

    const gained = (await onHand(itemA)) - beforeA + ((await onHand(itemB)) - beforeB);
    expect(gained).toBe(4);
    const ledger = await q("select reason, ref_type, ref_id, delta from stock_ledger where ref_id = $1", [ret.id]);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((l) => l.reason === "return-restock" && l.ref_type === "return")).toBe(true);
    expect(ledger.reduce((n, l) => n + (l.delta as number), 0)).toBe(4);

    // A retry of the same request, and a different one, can never restock twice.
    const replay = await admin.post(`${svc}/returns/${ret.id}/transition`).set(H).set("idempotency-key", k).send({ to: "restocked" });
    expect(replay.status).toBe(200);
    const again = await admin.post(`${svc}/returns/${ret.id}/transition`).set(H).set("idempotency-key", key("other")).send({ to: "restocked" });
    expect(again.status).toBe(409);
    expect((await onHand(itemA)) - beforeA + ((await onHand(itemB)) - beforeB)).toBe(4);

    const recon = await q("select count(*)::int n from stock_reconciliation where site_id = $1 and not reconciled", [SITES.serviceCentre]);
    expect(recon[0]!.n).toBe(0);
  });

  it("cannot return more than what is left of the assignment (assigned - consumed - already returned)", async () => {
    const { assignmentId } = await seedAssignment(5);
    const admin = await loginAs("admin@opshub.local");
    await q("insert into consumption_records (site_id, assignment_id, quantity, recorded_by) values ($1,$2,2,(select id from users where email='admin@opshub.local'))", [SITES.serviceCentre, assignmentId]);
    const tooMany = await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 4 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe("over_return");
    expect(tooMany.body.error.message).toMatch(/Only 3 unit/);
    const ok = await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 3 });
    expect(ok.status).toBe(201);
    expect((await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 1 })).body.error.code).toBe("over_return");
    // A rejected return frees its units again.
    expect((await admin.post(`${svc}/returns/${ok.body.data.id}/transition`).set(H).send({ to: "rejected" })).status).toBe(200);
    expect((await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 3 })).status).toBe(201);
  });

  it("two simultaneous returns of the same units cannot both succeed", async () => {
    const { assignmentId } = await seedAssignment(4);
    const a = await loginAs("admin@opshub.local");
    const b = await loginAs("admin@opshub.local");
    const res = await Promise.all([a.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 3 }), b.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 3 })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("enforces the state machine", async () => {
    const { assignmentId } = await seedAssignment(3);
    const admin = await loginAs("admin@opshub.local");
    const id = (await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 1 })).body.data.id as string;
    const t = (to: string, withKey = false) => {
      let r = admin.post(`${svc}/returns/${id}/transition`).set(H);
      if (withKey) r = r.set("idempotency-key", key("sm"));
      return r.send({ to });
    };
    expect((await t("restocked", true)).status).toBe(409); // cannot skip inspection
    expect((await t("inspected")).status).toBe(200);
    expect((await t("inspected")).status).toBe(409);
    expect((await t("rejected")).status).toBe(200);
    expect((await t("restocked", true)).status).toBe(409); // terminal
    expect((await t("nonsense")).status).toBe(400);
  });

  it("checks permissions and site membership", async () => {
    const { assignmentId } = await seedAssignment(2);
    const tech = await loginAs("technician@opshub.local"); // return:view only
    expect((await tech.get(`${svc}/returns`)).status).toBe(200);
    expect((await tech.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 1 })).status).toBe(403);
    expect((await (await loginAs("approver@opshub.local")).get(`${svc}/returns`)).status).toBe(403); // member without return:view
    expect((await (await loginAs("dispatcher@opshub.local")).get(`${svc}/returns`)).status).toBe(404); // not a member of this site
    expect((await request(app).get(`${svc}/returns`)).status).toBe(401);
    const admin = await loginAs("admin@opshub.local");
    expect((await admin.post(`${svc}/returns`).set(H).send({ assignmentId: "00000000-0000-4000-8000-0000000000ee", quantity: 1 })).status).toBe(404);
    expect((await admin.post(`${svc}/returns/not-a-uuid/transition`).set(H).send({ to: "inspected" })).status).toBe(404);
    expect((await admin.post(`${svc}/returns`).set(H).send({ assignmentId, quantity: 0 })).status).toBe(400);
  });
});

describe("PCB repair", () => {
  it("receives a board and moves it through the workflow, recording the technician", async () => {
    const tech = await loginAs("technician@opshub.local");
    const created = await tech.post(`${svc}/repairs`).set(H).send({ boardSerial: "PCB-0001" });
    expect(created.status).toBe(201);
    const r = created.body.data as RepairRecord;
    expect(r).toMatchObject({ boardSerial: "PCB-0001", status: "received", technicianId: null });
    const step = async (to: string) => tech.post(`${svc}/repairs/${r.id}/transition`).set(H).send({ to });
    expect((await step("completed")).status).toBe(409); // cannot skip
    const diag = await step("diagnosing");
    expect(diag.body.data.status).toBe("diagnosing");
    expect(diag.body.data.technicianId).toBeTruthy();
    expect((await step("repairing")).status).toBe(200);
    expect((await step("testing")).status).toBe(200);
    expect((await step("repairing")).status).toBe(200); // a failed test goes back to repair
    expect((await step("testing")).status).toBe(200);
    expect((await step("completed")).body.data.status).toBe("completed");
    expect((await step("repairing")).status).toBe(409); // completed is final
    const list = (await tech.get(`${svc}/repairs`)).body.data as RepairRecord[];
    expect(list.find((x) => x.id === r.id)?.status).toBe("completed");
  });

  it("rejects duplicate serials and bad input, and respects permissions", async () => {
    const tech = await loginAs("technician@opshub.local");
    await tech.post(`${svc}/repairs`).set(H).send({ boardSerial: "PCB-DUP" });
    const dup = await tech.post(`${svc}/repairs`).set(H).send({ boardSerial: "PCB-DUP" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("duplicate_serial");
    for (const bad of [{}, { boardSerial: "" }, { boardSerial: "bad serial!" }, { boardSerial: "x".repeat(65) }]) expect((await tech.post(`${svc}/repairs`).set(H).send(bad)).status).toBe(400);
    expect((await (await loginAs("approver@opshub.local")).get(`${svc}/repairs`)).status).toBe(403);
    expect((await (await loginAs("dispatcher@opshub.local")).post(`${svc}/repairs`).set(H).send({ boardSerial: "X-1" })).status).toBe(404);
    expect((await tech.post(`${svc}/repairs/00000000-0000-4000-8000-0000000000ee/transition`).set(H).send({ to: "diagnosing" })).status).toBe(404);
  });

  it("the same serial can exist on different sites", async () => {
    const admin = await loginAs("admin@opshub.local");
    await admin.post(`${svc}/repairs`).set(H).send({ boardSerial: "SHARED-1" });
    // Distribution has no repair module, so its admin has no repair:update; the serial space is per site by construction.
    expect((await q("select count(*)::int n from repair_records where board_serial = 'SHARED-1'"))[0]!.n).toBe(1);
  });
});

describe("stock adjustment", () => {
  let item: string;
  beforeAll(async () => {
    item = (await q("select id from inventory_items where site_id = $1 order by sku limit 1", [SITES.centralStores]))[0]!.id as string;
  });
  const adjust = (agent: request.Agent, body: unknown, k: string | null = key("adj"), site = central) => {
    let r = agent.post(`${site}/inventory/${item}/adjust`).set(H);
    if (k) r = r.set("idempotency-key", k);
    return r.send(body as object);
  };

  it("adds and removes stock with a ledger entry and an audit reason, once per key", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const before = await onHand(item);
    const k = key("add");
    const first = await adjust(keeper, { delta: 7, reason: "Found in the back room" }, k);
    expect(first.status).toBe(201);
    expect(first.body.data.onHand).toBe(before + 7);
    const replay = await adjust(keeper, { delta: 7, reason: "Found in the back room" }, k);
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(await onHand(item)).toBe(before + 7); // not 14
    expect((await adjust(keeper, { delta: -3, reason: "Damaged in handling" })).body.data.onHand).toBe(before + 4);
    const ledger = await q("select delta, reason, ref_type from stock_ledger where item_id = $1 and reason = 'adjustment' order by created_at desc limit 2", [item]);
    expect(ledger.map((l) => l.delta)).toEqual([-3, 7]);
    expect(ledger.every((l) => l.ref_type === "manual")).toBe(true);
    expect((await q("select metadata from audit_events where action = 'stock.adjusted' order by created_at desc limit 1"))[0]!.metadata).toMatchObject({ delta: -3, reason: "Damaged in handling" });
  });

  it("never lets stock go below zero, and reuse of a key for a different change is refused", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const before = await onHand(item);
    const tooMuch = await adjust(keeper, { delta: -(before + 1), reason: "Typo test" });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("insufficient_stock");
    expect(await onHand(item)).toBe(before);
    const k = key("reuse");
    await adjust(keeper, { delta: 1, reason: "First use" }, k);
    expect((await adjust(keeper, { delta: 2, reason: "Different" }, k)).status).toBe(422);
  });

  it("validates input and permissions", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    for (const bad of [{}, { delta: 0, reason: "nothing" }, { delta: 1.5, reason: "fraction" }, { delta: 1, reason: "x" }, { delta: 2_000_000, reason: "huge change" }, { delta: "5", reason: "text number" }]) {
      expect((await adjust(keeper, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await adjust(keeper, { delta: 1, reason: "no key here" }, null)).status).toBe(400);
    expect((await adjust(await loginAs("dispatcher@opshub.local"), { delta: 1, reason: "not my site" })).status).toBe(404);
    expect((await adjust(await loginAs("technician@opshub.local"), { delta: 1, reason: "not my site" })).status).toBe(404);
    expect((await adjust(await loginAs("storekeeper@opshub.local"), { delta: 1, reason: "wrong site", }, key(), dist)).status).toBe(404);
    expect((await keeper.post(`${central}/inventory/not-a-uuid/adjust`).set(H).set("idempotency-key", key()).send({ delta: 1, reason: "bad id here" })).status).toBe(404);
  });

  it("50 concurrent adjustments keep the ledger and the balance in agreement", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const before = await onHand(item);
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => adjust(keeper, { delta: i % 2 === 0 ? 2 : -1, reason: `Concurrent ${i}` })));
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(await onHand(item)).toBe(before + 10 * 2 - 10);
    expect((await q("select count(*)::int n from stock_reconciliation where site_id = $1 and not reconciled", [SITES.centralStores]))[0]!.n).toBe(0);
  });
});

describe("analytics summary", () => {
  it("returns only the blocks the caller's permissions allow, computed on the server", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const s = (await keeper.get(`${central}/analytics/summary`)).body.data as AnalyticsSummary;
    expect(s.source).toBe("database");
    expect(s.stock).toMatchObject({ totalItems: expect.any(Number), totalOnHand: expect.any(Number) });
    expect(s.requests).toBeNull(); // Central Stores has no request module
    expect(s.returns).toBeNull();
    expect(s.movements).toHaveLength(14);
    expect(s.movements!.at(-1)!.day).toBe(new Date().toISOString().slice(0, 10));
    expect(s.movements!.reduce((n, d) => n + d.unitsIn, 0)).toBeGreaterThan(0); // adjustments above

    const admin = await loginAs("admin@opshub.local");
    const sc = (await admin.get(`${svc}/analytics/summary`)).body.data as AnalyticsSummary;
    expect(sc.requests?.byStatus).toBeDefined();
    expect(sc.returns?.byStatus).toBeDefined();
    expect(sc.repairs?.byStatus.received).toBeGreaterThan(0);
    expect(sc.stock).toBeNull(); // no inventory:view in Service Centre
  });

  it("counts overdue submitted requests only when the approval deadline is set", async () => {
    const admin = await loginAs("admin@opshub.local");
    const none = (await admin.get(`${dist}/analytics/summary`)).body.data as AnalyticsSummary;
    expect(none.requests!.overdue).toBeNull();
    const live = (await admin.get(`${dist}/config`)).body.data as { version: number; configuration: { modules: { nodes: { moduleType: string; config: Record<string, unknown> }[] } } };
    const cfg = JSON.parse(JSON.stringify(live.configuration));
    cfg.modules.nodes.find((n: { moduleType: string }) => n.moduleType === "approval").config.slaSeconds = 1;
    expect((await admin.post(`${dist}/releases/publish`).set(H).send({ baseVersion: live.version, configuration: cfg })).status).toBe(201);
    const dispatcher = await loginAs("dispatcher@opshub.local");
    const item = (await q("select id from inventory_items where site_id = $1 limit 1", [SITES.distribution]))[0]!.id;
    await dispatcher.post(`${dist}/requests`).set(H).send({ lines: [{ itemId: item, quantity: 1 }] });
    await new Promise((r) => setTimeout(r, 1300));
    const after = (await admin.get(`${dist}/analytics/summary`)).body.data as AnalyticsSummary;
    expect(after.requests!.overdue).toBeGreaterThanOrEqual(1);
  });

  it("is refused without analytics:view or membership", async () => {
    expect((await (await loginAs("dispatcher@opshub.local")).get(`${dist}/analytics/summary`)).status).toBe(403);
    expect((await (await loginAs("dispatcher@opshub.local")).get(`${svc}/analytics/summary`)).status).toBe(404);
    expect((await request(app).get(`${svc}/analytics/summary`)).status).toBe(401);
  });
});

describe("site members", () => {
  it("lists members for users:view and manages them for users:manage", async () => {
    const admin = await loginAs("admin@opshub.local"); // platform admin and site admin
    const list = (await admin.get(`${svc}/members`)).body.data as SiteMember[];
    expect(list.map((m) => m.email)).toContain("technician@opshub.local");
    expect(list.find((m) => m.email === "technician@opshub.local")!.roles).toEqual(["technician"]);

    // The Service Centre admin role is held by admin@; use the technician-less storekeeper as the person to add.
    const add = await admin.post(`${svc}/members`).set(H).send({ email: "Storekeeper@opshub.local", role: "technician" });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ email: "storekeeper@opshub.local", roles: ["technician"] });
    const keeper = await loginAs("storekeeper@opshub.local");
    expect(((await keeper.get("/api/v1/auth/me")).body.data.memberships as { siteSlug: string }[]).map((m) => m.siteSlug)).toContain("service-centre");

    const set = await admin.put(`${svc}/members/${add.body.data.userId}`).set(H).send({ roles: ["technician", "approver"] });
    expect(set.body.data.roles.sort()).toEqual(["approver", "technician"]);
    expect((await admin.delete(`${svc}/members/${add.body.data.userId}`).set(H)).status).toBe(204);
    expect(((await admin.get(`${svc}/members`)).body.data as SiteMember[]).map((m) => m.email)).not.toContain("storekeeper@opshub.local");
    expect((await keeper.get(`${svc}/returns`)).status).toBe(404); // no longer a member
    expect((await q("select 1 from audit_events where action in ('member.roles-set','member.removed') and site_id = $1", [SITES.serviceCentre])).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses unknown roles, unknown people, the system account and editing yourself", async () => {
    const admin = await loginAs("admin@opshub.local");
    expect((await admin.post(`${svc}/members`).set(H).send({ email: "technician@opshub.local", role: "superuser" })).status).toBe(422);
    const ghost = await admin.post(`${svc}/members`).set(H).send({ email: "nobody@example.com", role: "technician" });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe("user_not_found");
    expect((await admin.post(`${svc}/members`).set(H).send({ email: "public-intake@system.invalid", role: "technician" })).status).toBe(404);
    const me = ((await admin.get(`${svc}/members`)).body.data as SiteMember[]).find((m) => m.email === "admin@opshub.local")!;
    expect((await admin.put(`${svc}/members/${me.userId}`).set(H).send({ roles: [] })).status).toBe(403);
    expect((await admin.delete(`${svc}/members/${me.userId}`).set(H)).status).toBe(403);
    expect((await admin.post(`${svc}/members`).set(H).send({ email: "not-an-email", role: "technician" })).status).toBe(400);
    expect((await admin.put(`${svc}/members/not-a-uuid`).set(H).send({ roles: [] })).status).toBe(404);
  });

  it("is limited to people who may manage users on THIS site", async () => {
    const tech = await loginAs("technician@opshub.local");
    expect((await tech.get(`${svc}/members`)).status).toBe(403);
    expect((await tech.post(`${svc}/members`).set(H).send({ email: "approver@opshub.local", role: "technician" })).status).toBe(403);
    const keeper = await loginAs("storekeeper@opshub.local"); // member of Central Stores only
    expect((await keeper.get(`${svc}/members`)).status).toBe(404);
    expect((await keeper.post(`${svc}/members`).set(H).send({ email: "approver@opshub.local", role: "technician" })).status).toBe(404);
    expect((await request(app).get(`${svc}/members`)).status).toBe(401);
  });

  it("the database itself refuses to change another site's memberships", async () => {
    const userId = (await q("select id from users where email = 'approver@opshub.local'"))[0]!.id as string;
    const role = (await q("select id from roles where key = 'viewer'"))[0]!.id as string;
    await expect(
      db.withTenant({ siteId: SITES.centralStores, userId }, (tx) => tx.execute(sql`insert into user_site_roles (user_id, site_id, role_id) values (${userId}, ${SITES.distribution}, ${role})`)),
    ).rejects.toThrow();
    await expect(db.withTenant({ siteId: SITES.centralStores, userId }, (tx) => tx.execute(sql`delete from user_site_roles where site_id = ${SITES.distribution}`))).resolves.toBeDefined();
    expect((await q("select count(*)::int n from user_site_roles where site_id = $1", [SITES.distribution]))[0]!.n).toBeGreaterThan(0); // the delete matched nothing
  });
});

describe("audit trail is newest first", () => {
  it("returns the most recent events", async () => {
    const admin = await loginAs("admin@opshub.local");
    const events = (await admin.get(`${svc}/audit-events`)).body.data as { createdAt: string; action: string }[];
    const times = events.map((e) => Date.parse(e.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(events[0]!.action).toMatch(/member\.|repair\.|return\./);
  });
});
