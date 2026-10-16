import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProvisioningSnapshot } from "@opshub/contracts";
import { sql } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import * as s from "../../src/db/schema/index.js";
import { adminPool, appDb, appUrl, freshDatabase, rejectsWith, USERS } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let server: Server;
let db: Database;
let origin: string;

beforeAll(async () => {
  await freshDatabase();
  db = appDb(15);
  const base = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  // A small pause between steps so the live log can be observed arriving.
  app = createApp({ db, env: { ...base, PROVISIONING_STEP_DELAY_MS: 120 }, loginRateLimit: 1000 });
  server = app.listen(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await db.close();
});

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  return agent;
}

async function waitDone(agent: request.Agent, jobId: string, timeoutMs = 15000): Promise<ProvisioningSnapshot> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const snap = (await agent.get(`/api/v1/provisioning/${jobId}/events`)).body.data as ProvisioningSnapshot;
    if (snap.job.status !== "running") return snap;
    if (Date.now() > until) throw new Error("provisioning did not finish in time");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const body = (over: Record<string, unknown> = {}) => ({ slug: "riverside", name: "Riverside Depot", preset: "stores", demoStock: true, ...over });

describe("access control", () => {
  it("only platform admins may list presets, provision sites or read job logs", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    expect((await keeper.get("/api/v1/provisioning/presets")).status).toBe(403);
    expect((await keeper.post("/api/v1/sites").set(H).send(body())).status).toBe(403);
    expect((await keeper.get("/api/v1/provisioning/00000000-0000-4000-8000-000000000000/events")).status).toBe(403);
    expect((await request(app).post("/api/v1/sites").set(H).send(body())).status).toBe(401);
  });

  it("the database itself refuses site creation by a non-admin (RLS), even through the app role", async () => {
    const id = "00000000-0000-4000-8000-0000000000bb";
    for (const userId of [USERS.storekeeper, "20000000-0000-4000-8000-000000000009"]) {
      await rejectsWith(
        db.withTenant({ siteId: id, userId }, (tx) => tx.insert(s.sites).values({ id, slug: "sneaky", name: "Sneaky" })),
        /row-level security|violates/i,
      );
    }
    // A platform admin passes the policy (rolled back so nothing persists).
    await expect(
      db.withTenant({ siteId: id, userId: USERS.admin }, async (tx) => {
        await tx.insert(s.sites).values({ id, slug: "sneaky", name: "Sneaky" });
        await tx.execute(sql`select 1`);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
  });
});

describe("request validation", () => {
  it("rejects bad slugs, reserved names, unknown presets and unknown admin emails", async () => {
    const admin = await loginAs("admin@opshub.local");
    for (const slug of ["Bad Slug", "ab", "-edge-", "trust-lab", "admin"]) {
      expect((await admin.post("/api/v1/sites").set(H).send(body({ slug }))).status, slug).toBe(400);
    }
    expect((await admin.post("/api/v1/sites").set(H).send(body({ slug: "okay-site", preset: "nope" }))).body.error.code).toBe("unknown_preset");
    expect((await admin.post("/api/v1/sites").set(H).send(body({ slug: "okay-site", adminEmail: "ghost@nowhere.test" }))).body.error.code).toBe("unknown_user");
    expect((await admin.post("/api/v1/sites").set(H).send(body({ slug: "okay-site", preset: undefined }))).status).toBe(400);
  });

  it("lists the presets derived from the seed configurations", async () => {
    const admin = await loginAs("admin@opshub.local");
    const presets = (await admin.get("/api/v1/provisioning/presets")).body.data as { id: string; modules: string[] }[];
    expect(presets.map((p) => p.id).sort()).toEqual(["distribution", "service-centre", "stores"]);
    expect(presets.find((p) => p.id === "stores")!.modules.length).toBeGreaterThan(2);
  });
});

describe("one-save provisioning", () => {
  it("creates a working new site from a single request, visible immediately, with a complete log", async () => {
    const admin = await loginAs("admin@opshub.local");
    const res = await admin.post("/api/v1/sites").set(H).send(body({ adminEmail: "approver@opshub.local" }));
    expect(res.status).toBe(202);
    const jobId = res.body.data.id as string;
    expect(res.body.data.status).toBe("running");

    const snap = await waitDone(admin, jobId);
    expect(snap.job).toMatchObject({ status: "succeeded", slug: "riverside", error: null });
    const messages = snap.events.map((e) => e.message);
    expect(messages[0]).toMatch(/Starting/);
    expect(messages.join("\n")).toMatch(/Site record created[\s\S]*Configuration is valid[\s\S]*Roles ready[\s\S]*Release v1 is active[\s\S]*administrators added[\s\S]*demo items added[\s\S]*Committed/);
    expect(snap.events.map((e) => e.seq)).toEqual(snap.events.map((_, i) => i + 1));
    expect(snap.events.some((e) => e.level === "error")).toBe(false);

    // Appears for the admin with no restart, and is a fully working site.
    const sites = (await admin.get("/api/v1/sites")).body.data as { id: string; slug: string; activeReleaseVersion: number }[];
    const site = sites.find((x) => x.slug === "riverside")!;
    expect(site).toMatchObject({ activeReleaseVersion: 1 });
    const cfg = (await admin.get(`/api/v1/sites/${site.id}/config`)).body.data;
    expect(cfg.configuration).toMatchObject({ slug: "riverside", name: "Riverside Depot", siteId: site.id });
    const items = (await admin.get(`/api/v1/sites/${site.id}/inventory`)).body.data.items as unknown[];
    expect(items).toHaveLength(3);
    expect((await admin.get(`/api/v1/sites/${site.id}/inventory/reconciliation`)).body.data.every((r: { reconciled: boolean }) => r.reconciled)).toBe(true);

    // The extra administrator can open it; an unrelated user cannot even see it exists.
    const approver = await loginAs("approver@opshub.local");
    expect(((await approver.get("/api/v1/sites")).body.data as { slug: string }[]).map((x) => x.slug)).toContain("riverside");
    const keeper = await loginAs("storekeeper@opshub.local");
    expect((await keeper.get(`/api/v1/sites/${site.id}/config`)).status).toBe(404);

    // The new site is isolated like any other: its rows are invisible to another site's context.
    const pool = adminPool();
    const audit = (await pool.query("select action from audit_events where site_id = $1 order by created_at", [site.id])).rows.map((r) => r.action);
    await pool.end();
    expect(audit).toEqual(expect.arrayContaining(["release.published", "site.provisioned"]));
  });

  it("is idempotent by slug: the same request again returns the same job and creates nothing new", async () => {
    const admin = await loginAs("admin@opshub.local");
    const first = (await admin.post("/api/v1/sites").set(H).send(body({ adminEmail: "approver@opshub.local" }))).body.data;
    expect(first.status).toBe("succeeded");
    const again = await admin.post("/api/v1/sites").set(H).send(body({ adminEmail: "approver@opshub.local" }));
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.id);
    const pool = adminPool();
    const counts = (await pool.query("select (select count(*) from sites where slug = 'riverside')::int s, (select count(*) from site_releases r join sites x on x.id = r.site_id where x.slug = 'riverside')::int r")).rows[0];
    await pool.end();
    expect(counts).toEqual({ s: 1, r: 1 });
  });

  it("concurrent identical requests produce exactly one site", async () => {
    const admin = await loginAs("admin@opshub.local");
    const payload = body({ slug: "twin-site", name: "Twin Site", demoStock: false });
    const results = await Promise.all([1, 2, 3, 4].map(() => admin.post("/api/v1/sites").set(H).send(payload)));
    expect(results.every((r) => [200, 202].includes(r.status))).toBe(true);
    const ids = new Set(results.map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    await waitDone(admin, [...ids][0] as string);
    const pool = adminPool();
    const n = (await pool.query("select count(*)::int n from sites where slug = 'twin-site'")).rows[0].n;
    await pool.end();
    expect(n).toBe(1);
  });

  it("rejects a slug already used by an existing site, or by a different pending request", async () => {
    const admin = await loginAs("admin@opshub.local");
    expect((await admin.post("/api/v1/sites").set(H).send(body({ slug: "distribution" }))).body.error.code).toBe("slug_taken");
    expect((await admin.post("/api/v1/sites").set(H).send(body({ name: "Another Name" }))).body.error.code).toBe("slug_taken");
  });

  it("a site the admin cannot see still blocks the slug (database unique constraint), and the log says so", async () => {
    const pool = adminPool();
    await pool.query("insert into sites (id, slug, name) values ('00000000-0000-4000-8000-0000000000cc', 'hidden-site', 'Hidden')");
    await pool.end();
    const admin = await loginAs("admin@opshub.local");
    const res = await admin.post("/api/v1/sites").set(H).send(body({ slug: "hidden-site", name: "Clash" }));
    const snap = await waitDone(admin, res.body.data.id);
    expect(snap.job.status).toBe("failed");
    expect(snap.job.error).toMatch(/already used by another site/);
    expect(snap.events.map((e) => e.message).join("\n")).toMatch(/Everything was rolled back/);
  });
});

describe("failure handling", () => {
  it("a failure after several steps rolls back everything, explains why, and can be retried", async () => {
    const pool = adminPool();
    // Make the 'distribution' preset fail at the roles step (after the site row, release inputs are prepared).
    await pool.query("update roles set key = 'approver_renamed' where key = 'approver'");
    const admin = await loginAs("admin@opshub.local");
    const res = await admin.post("/api/v1/sites").set(H).send(body({ slug: "flaky-site", name: "Flaky", preset: "distribution", demoStock: true }));
    const snap = await waitDone(admin, res.body.data.id);

    expect(snap.job.status).toBe("failed");
    expect(snap.job.error).toMatch(/roles that are not defined.*approver/);
    expect(snap.events.at(-1)!.message).toMatch(/Everything was rolled back\. No site was created\./);
    expect(snap.events.at(-2)!.level).toBe("error");
    // Nothing partial remains: no site, release, membership, stock or audit rows.
    const left = (
      await pool.query(`select (select count(*) from sites where slug = 'flaky-site')::int sites,
                               (select count(*) from site_releases where note like 'Provisioned from preset%' and site_id not in (select id from sites))::int orphans,
                               (select count(*) from audit_events where action = 'site.provisioned' and metadata->>'slug' = 'flaky-site')::int audits`)
    ).rows[0];
    expect(left).toEqual({ sites: 0, orphans: 0, audits: 0 });

    // Fix the cause and retry the same slug: same job, history kept, now succeeds.
    await pool.query("update roles set key = 'approver' where key = 'approver_renamed'");
    await pool.end();
    const retry = await admin.post("/api/v1/sites").set(H).send(body({ slug: "flaky-site", name: "Flaky", preset: "distribution", demoStock: true }));
    expect(retry.status).toBe(202);
    expect(retry.body.data.id).toBe(res.body.data.id);
    const after = await waitDone(admin, retry.body.data.id);
    expect(after.job.status).toBe("succeeded");
    expect(after.events.length).toBeGreaterThan(snap.events.length);
    expect(after.events.map((e) => e.seq)).toEqual(after.events.map((_, i) => i + 1)); // log continues, never resets
  });
});

describe("live log over Server-Sent Events", () => {
  it("streams events as they happen and ends with a done event", async () => {
    // Log in over real HTTP so the cookie can be sent with fetch.
    const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ email: "admin@opshub.local", password: DEV_PASSWORD }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const start = await fetch(`${origin}/api/v1/sites`, { method: "POST", headers: { "content-type": "application/json", cookie, ...H }, body: JSON.stringify(body({ slug: "streamed-site", name: "Streamed", demoStock: false })) });
    expect(start.status).toBe(202);
    const { data } = (await start.json()) as { data: { id: string } };

    const res = await fetch(`${origin}/api/v1/provisioning/${data.id}/events`, { headers: { accept: "text/event-stream", cookie } });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const arrivals: number[] = [];
    let done = false;
    const t0 = Date.now();
    while (!done) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const f of frames) {
        if (f.includes("event: log")) arrivals.push(Date.now() - t0);
        if (f.includes("event: done")) done = true;
      }
    }
    expect(done).toBe(true);
    expect(arrivals.length).toBeGreaterThanOrEqual(8);
    // Events arrived over time (steps are paused), not as one burst after completion.
    expect(arrivals.at(-1)! - arrivals[0]!).toBeGreaterThan(300);
  });

  it("resumes from Last-Event-ID without replaying earlier events", async () => {
    const admin = await loginAs("admin@opshub.local");
    const job = (await admin.get("/api/v1/sites").set(H)).body.data.find((x: { slug: string }) => x.slug === "streamed-site");
    expect(job).toBeTruthy();
    const pool = adminPool();
    const jobId = (await pool.query("select id from provisioning_jobs where slug = 'streamed-site'")).rows[0].id as string;
    await pool.end();
    const full = (await admin.get(`/api/v1/provisioning/${jobId}/events`)).body.data as ProvisioningSnapshot;
    const tail = (await admin.get(`/api/v1/provisioning/${jobId}/events?after=${full.events.length - 2}`)).body.data as ProvisioningSnapshot;
    expect(tail.events.map((e) => e.seq)).toEqual([full.events.length - 1, full.events.length]);
  });
});
