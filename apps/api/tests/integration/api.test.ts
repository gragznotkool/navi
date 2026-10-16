import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteConfiguration } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;

async function loginAs(email: string, password = DEV_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").set(H).send({ email, password });
  return { agent, res };
}

const loadConfig = async (agent: request.Agent, siteId: string): Promise<{ version: number; configuration: SiteConfiguration }> =>
  (await agent.get(`/api/v1/sites/${siteId}/config`)).body.data;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: process.env.TEST_APP_URL!, JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

describe("health and registry", () => {
  it("health and ready work without auth", async () => {
    expect((await request(app).get("/api/v1/health")).body.data.status).toBe("ok");
    const ready = await request(app).get("/api/v1/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.data.checks.database).toBe("ok");
  });
  it("unknown routes return a consistent error", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});

describe("authentication", () => {
  it("rejects invalid credentials without revealing which part was wrong", async () => {
    const bad = await loginAs("admin@opshub.local", "wrong-password");
    const unknown = await loginAs("nobody@opshub.local", "whatever");
    expect(bad.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(bad.res.body.error.message).toBe(unknown.res.body.error.message);
  });

  it("validates the login body", async () => {
    const res = await request(app).post("/api/v1/auth/login").set(H).send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("issues an httpOnly cookie and never returns a password hash or token in the body", async () => {
    const { res } = await loginAs("storekeeper@opshub.local");
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|token/i);
    expect(res.body.data.memberships.map((m: { siteSlug: string }) => m.siteSlug)).toEqual(["central-stores"]);
  });

  it("requires authentication and the client header on mutations", async () => {
    expect((await request(app).get("/api/v1/sites")).status).toBe(401);
    const res = await request(app).post("/api/v1/auth/login").send({ email: "admin@opshub.local", password: DEV_PASSWORD });
    expect(res.status).toBe(403);
  });

  it("rejects forged and tampered tokens", async () => {
    const forged = await request(app).get("/api/v1/auth/me").set("Cookie", "opshub_session=not.a.jwt");
    expect(forged.status).toBe(401);
  });

  it("logout revokes the session server-side", async () => {
    const { agent, res } = await loginAs("technician@opshub.local");
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    expect((await agent.post("/api/v1/auth/logout").set(H)).status).toBe(204);
    // Replaying the old token (as an attacker who copied it would) must fail.
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("records failed logins in the audit log", async () => {
    const admin = adminPool();
    const r = await admin.query("select count(*)::int n from audit_events where action = 'auth.login-failed'");
    await admin.end();
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});

describe("site membership and tenancy", () => {
  it("lists only the sites the user belongs to", async () => {
    const { agent } = await loginAs("storekeeper@opshub.local");
    const res = await agent.get("/api/v1/sites");
    expect(res.body.data.map((x: { slug: string }) => x.slug)).toEqual(["central-stores"]);
    expect(res.body.data[0].accent).toBe("#0F766E");
  });

  it("returns 404 (not 403) for a site the user is not a member of, without leaking its data", async () => {
    const { agent } = await loginAs("storekeeper@opshub.local");
    for (const path of ["", "/config", "/inventory", "/releases"]) {
      const res = await agent.get(`/api/v1/sites/${SITES.distribution}${path}`);
      expect(res.status, path).toBe(404);
    }
  });

  it("rejects malformed site ids", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    expect((await agent.get("/api/v1/sites/not-a-uuid/config")).status).toBe(404);
  });

  it("returns the active configuration for a member", async () => {
    const { agent } = await loginAs("approver@opshub.local");
    const cfg = await loadConfig(agent, SITES.distribution);
    expect(cfg.version).toBe(1);
    expect(cfg.configuration.slug).toBe("distribution");
  });

  it("enforces role permissions server-side", async () => {
    const { agent } = await loginAs("storekeeper@opshub.local");
    // storekeeper has inventory:view but not request:create
    expect((await agent.get(`/api/v1/sites/${SITES.centralStores}/inventory`)).status).toBe(200);
    const res = await agent.get(`/api/v1/sites/${SITES.centralStores}/requests`);
    expect(res.status).toBe(403);
  });

  it("serves the 13-module registry", async () => {
    const { agent } = await loginAs("storekeeper@opshub.local");
    expect((await agent.get("/api/v1/modules")).body.data).toHaveLength(13);
  });

  it("returns honest 501s for unbuilt endpoints", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const res = await agent.get(`/api/v1/sites/${SITES.serviceCentre}/repairs`);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });
});

describe("configuration validation and release lifecycle", () => {
  const withReturns = (cfg: SiteConfiguration): SiteConfiguration => {
    const c = JSON.parse(JSON.stringify(cfg)) as SiteConfiguration;
    c.modules.nodes.push({ id: "return-management", moduleType: "return-management", position: { x: 0, y: 400 }, config: {} });
    c.modules.edges.push({ id: "assignment->returns", sourceNodeId: "material-assignment", sourcePortId: "assignment-out", targetNodeId: "return-management", targetPortId: "assignment-in" });
    c.pages.push({ id: "returns", title: "Returns", path: "returns", nodeId: "return-management", layoutId: "data-table", requiredPermission: "return:view" });
    c.navigation.push({ pageId: "returns", label: "Returns" });
    return c;
  };

  it("only platform admins can validate, preview, draft or publish", async () => {
    const { agent } = await loginAs("approver@opshub.local");
    const cfg = await loadConfig(agent, SITES.distribution);
    for (const [method, path, body] of [
      ["post", "config/validate", { configuration: cfg.configuration }],
      ["post", "config/preview", { configuration: cfg.configuration }],
      ["put", "config/draft", { baseVersion: 1, configuration: cfg.configuration }],
      ["post", "releases/publish", { baseVersion: 1, configuration: cfg.configuration }],
      ["post", "releases/rollback", { baseVersion: 1, targetVersion: 1 }],
    ] as const) {
      const res = await agent[method](`/api/v1/sites/${SITES.distribution}/${path}`).set(H).send(body);
      expect(res.status, path).toBe(403);
    }
  });

  it("validate returns structured errors and never repairs input", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const cfg = await loadConfig(agent, SITES.distribution);
    const bad = JSON.parse(JSON.stringify(cfg.configuration)) as SiteConfiguration;
    bad.pages[1]!.layoutId = "ghost";
    const res = await agent.post(`/api/v1/sites/${SITES.distribution}/config/validate`).set(H).send({ configuration: bad });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.errors[0].code).toBe("pages.missing-layout");
  });

  it("publish cannot bypass validation", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const cfg = await loadConfig(agent, SITES.distribution);
    const bad = JSON.parse(JSON.stringify(cfg.configuration)) as SiteConfiguration;
    bad.modules.nodes = bad.modules.nodes.filter((n) => n.moduleType !== "auth-rbac");
    const res = await agent.post(`/api/v1/sites/${SITES.distribution}/releases/publish`).set(H).send({ baseVersion: 1, configuration: bad });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("configuration_invalid");
    expect((await loadConfig(agent, SITES.distribution)).version).toBe(1);
  });

  it("rejects a configuration for a different site", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const other = (await loadConfig(agent, SITES.centralStores)).configuration;
    const res = await agent.post(`/api/v1/sites/${SITES.distribution}/releases/publish`).set(H).send({ baseVersion: 1, configuration: other });
    expect(res.status).toBe(422);
  });

  it("publishes enabling Return Management on Distribution through the generic path, then rolls back", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const base = `/api/v1/sites/${SITES.distribution}`;
    const v1 = await loadConfig(agent, SITES.distribution);
    expect(v1.configuration.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(false);

    const next = withReturns(v1.configuration);
    const preview = await agent.post(`${base}/config/preview`).set(H).send({ configuration: next });
    expect(preview.status).toBe(200);

    const pub = await agent.post(`${base}/releases/publish`).set(H).send({ baseVersion: 1, configuration: next, note: "Enable returns" });
    expect(pub.status).toBe(201);
    expect(pub.body.data.version).toBe(2);
    expect(pub.body.data.isActive).toBe(true);

    // Active config changes with no restart.
    const v2 = await loadConfig(agent, SITES.distribution);
    expect(v2.version).toBe(2);
    expect(v2.configuration.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(true);

    // Stale draft is rejected.
    const stale = await agent.post(`${base}/releases/publish`).set(H).send({ baseVersion: 1, configuration: next });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_draft");
    const staleDraft = await agent.put(`${base}/config/draft`).set(H).send({ baseVersion: 1, configuration: next });
    expect(staleDraft.status).toBe(409);

    // Diff shows the module addition.
    const diff = await agent.get(`${base}/releases/${pub.body.data.id}/diff`);
    expect(diff.body.data.entries.some((e: { path: string; change: string }) => e.path.includes("return-management") && e.change === "added")).toBe(true);

    // Rollback creates a NEW release; history is preserved.
    const rb = await agent.post(`${base}/releases/rollback`).set(H).send({ baseVersion: 2, targetVersion: 1 });
    expect(rb.status).toBe(201);
    expect(rb.body.data.version).toBe(3);
    expect(rb.body.data.rolledBackToVersion).toBe(1);
    const v3 = await loadConfig(agent, SITES.distribution);
    expect(v3.configuration.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(false);

    const history = (await agent.get(`${base}/releases`)).body.data as { version: number; isActive: boolean }[];
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]);
    expect(history.filter((h) => h.isActive).map((h) => h.version)).toEqual([3]);

    const audit = (await agent.get(`${base}/audit-events`)).body.data as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["release.published", "release.rolled-back", "draft.saved"].filter((a) => a !== "draft.saved")));
  });

  it("concurrent publishes from the same base: exactly one wins", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const base = `/api/v1/sites/${SITES.centralStores}`;
    const cfg = await loadConfig(agent, SITES.centralStores);
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        agent.post(`${base}/releases/publish`).set(H).send({ baseVersion: cfg.version, configuration: { ...cfg.configuration, metadata: { ...cfg.configuration.metadata, attempt: String(i) } } }),
      ),
    );
    expect(attempts.filter((a) => a.status === 201)).toHaveLength(1);
    expect(attempts.filter((a) => a.status === 409)).toHaveLength(4);
    const history = (await agent.get(`${base}/releases`)).body.data as unknown[];
    expect(history).toHaveLength(2);
  });
});

describe("request, approval and assignment flow", () => {
  it("runs submit -> approve -> assign with idempotent retry and rejects invalid transitions", async () => {
    const admin = adminPool();
    const item = (await admin.query("select id, on_hand from inventory_items where site_id = $1 and sku = 'MCB-16A'", [SITES.distribution])).rows[0];
    await admin.end();
    const dispatcher = (await loginAs("dispatcher@opshub.local")).agent;
    const approver = (await loginAs("approver@opshub.local")).agent;
    const base = `/api/v1/sites/${SITES.distribution}`;

    const created = await dispatcher.post(`${base}/requests`).set(H).send({ lines: [{ itemId: item.id, quantity: 5 }] });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe("submitted");

    // Not yet approved => cannot assign.
    const early = await dispatcher.post(`${base}/assignments`).set(H).set("Idempotency-Key", "key-early-0001").send({ requestId: id });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("invalid_transition");

    // A dispatcher cannot approve.
    expect((await dispatcher.post(`${base}/requests/${id}/decision`).set(H).send({ decision: "approved" })).status).toBe(403);

    expect((await approver.post(`${base}/requests/${id}/decision`).set(H).send({ decision: "approved" })).status).toBe(200);
    // Deciding twice is an invalid transition.
    expect((await approver.post(`${base}/requests/${id}/decision`).set(H).send({ decision: "rejected" })).status).toBe(409);

    const first = await dispatcher.post(`${base}/assignments`).set(H).set("Idempotency-Key", "key-assign-0001").send({ requestId: id });
    expect(first.status).toBe(201);
    const retry = await dispatcher.post(`${base}/assignments`).set(H).set("Idempotency-Key", "key-assign-0001").send({ requestId: id });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    const reuse = await dispatcher.post(`${base}/assignments`).set(H).set("Idempotency-Key", "key-assign-0001").send({ requestId: "00000000-0000-4000-8000-0000000000aa" });
    expect(reuse.status).toBe(422);

    // Missing key is rejected.
    expect((await dispatcher.post(`${base}/assignments`).set(H).send({ requestId: id })).status).toBe(400);

    // Exactly one stock movement happened.
    const a2 = adminPool();
    const after = (await a2.query("select on_hand from inventory_items where id = $1", [item.id])).rows[0];
    const ledger = (await a2.query("select count(*)::int n from stock_ledger where item_id = $1 and reason = 'assignment'", [item.id])).rows[0];
    await a2.end();
    expect(after.on_hand).toBe(item.on_hand - 5);
    expect(ledger.n).toBe(1);

    // Consumption cannot exceed the assignment.
    const over = await dispatcher.post(`${base}/consumption`).set(H).send({ assignmentId: first.body.data.id, quantity: 6 });
    expect(over.status).toBe(409);
    expect((await dispatcher.post(`${base}/consumption`).set(H).send({ assignmentId: first.body.data.id, quantity: 5 })).status).toBe(201);
    expect((await dispatcher.get(`${base}/requests/${id}`)).body.data.status).toBe("fulfilled");
  });

  it("cannot read another site's request by id", async () => {
    const dispatcher = (await loginAs("dispatcher@opshub.local")).agent;
    const admin = adminPool();
    const item = (await admin.query("select id from inventory_items where site_id = $1 limit 1", [SITES.centralStores])).rows[0];
    const req = (await admin.query("insert into requests (site_id, status, requested_by, release_version) values ($1,'submitted','10000000-0000-4000-8000-000000000002',1) returning id", [SITES.centralStores])).rows[0];
    await admin.query("insert into request_lines (site_id, request_id, item_id, quantity) values ($1,$2,$3,1)", [SITES.centralStores, req.id, item.id]);
    await admin.end();
    // dispatcher is a member of distribution only
    expect((await dispatcher.get(`/api/v1/sites/${SITES.distribution}/requests/${req.id}`)).status).toBe(404);
    expect((await dispatcher.get(`/api/v1/sites/${SITES.centralStores}/requests/${req.id}`)).status).toBe(404);
  });
});

describe("system sites in listings", () => {
  it("never lists the reserved trust-lab site, even for a platform admin", async () => {
    const { agent } = await loginAs("admin@opshub.local");
    const res = await agent.get("/api/v1/sites");
    expect(res.body.data.map((x: { slug: string }) => x.slug)).not.toContain("trust-lab");
    expect(res.body.data).toHaveLength(3);
  });
});
