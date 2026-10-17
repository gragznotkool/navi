import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getWebsiteTheme, type SiteConfiguration, type WebsiteTemplate } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { appDb, freshDatabase, USERS } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  return agent;
}

/** Follows a provisioning job through the JSON polling fallback until it finishes. */
async function waitForJob(agent: request.Agent, jobId: string): Promise<{ status: string; error: string | null; messages: string[] }> {
  for (let i = 0; i < 100; i++) {
    const snap = (await agent.get(`/api/v1/provisioning/${jobId}/events`).set(H)).body.data;
    if (snap.job.status !== "running") return { status: snap.job.status, error: snap.job.error, messages: snap.events.map((e: { message: string }) => e.message) };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("provisioning did not finish");
}

const siteIdOf = async (agent: request.Agent, slug: string): Promise<string | undefined> =>
  ((await agent.get("/api/v1/sites").set(H)).body.data as { id: string; slug: string }[]).find((s) => s.slug === slug)?.id;

let admin: request.Agent;
let templates: WebsiteTemplate[];

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: process.env.TEST_APP_URL!, JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
  admin = await loginAs("admin@opshub.local");
  templates = (await admin.get("/api/v1/hub/website-templates").set(H)).body.data;
});
afterAll(async () => {
  await db.close();
});

const deploy = (agent: request.Agent, body: Record<string, unknown>) => agent.post("/api/v1/hub/websites/deploy").set(H).send(body);
const bodyFor = (templateId: string, slug: string, themeId: string, access: Record<string, unknown>) => {
  const t = templates.find((x) => x.id === templateId)!;
  return { name: `Site ${slug}`, slug, templateId, theme: getWebsiteTheme(themeId), configuration: t.configuration, access };
};

describe("website templates", () => {
  it("lists six themed templates for platform admins", () => {
    expect(templates).toHaveLength(6);
    for (const t of templates) {
      const cfg = t.configuration as SiteConfiguration;
      expect(cfg.website?.id).toBe(t.theme.id);
      expect(cfg.shell).toBe(t.theme.shell);
      expect(t.moduleCount).toBeGreaterThan(0);
    }
  });

  it("is refused to non-admins", async () => {
    const sk = await loginAs("storekeeper@opshub.local");
    expect((await sk.get("/api/v1/hub/website-templates").set(H)).status).toBe(403);
    expect((await deploy(sk, bodyFor("ocean-breeze", "sk-site", "ocean-breeze", { mode: "all", roleId: "viewer" }))).status).toBe(403);
  });
});

describe("admin-only website builder", () => {
  it("refuses every website-builder endpoint to non-admins, including ones added later", async () => {
    for (const email of ["storekeeper@opshub.local", "technician@opshub.local", "approver@opshub.local"]) {
      const user = await loginAs(email);
      const calls = [
        user.get("/api/v1/hub/website-builder"),
        user.get("/api/v1/hub/website-templates"),
        user.get("/api/v1/hub/users"),
        user.get("/api/v1/hub/websites"),
        user.post("/api/v1/hub/websites/deploy").send({}),
        user.get(`/api/v1/hub/websites/${USERS.admin}/access`),
        user.patch(`/api/v1/hub/websites/${USERS.admin}/access`).send({}),
        user.get("/api/v1/hub/websites/some-future-endpoint"),
      ];
      const statuses = (await Promise.all(calls.map((c) => c.set(H)))).map((r) => r.status);
      expect(statuses, email).toEqual(calls.map(() => 403));
    }
  });
});

describe("website builder host", () => {
  it("lives in Central Stores' builder", async () => {
    const res = await admin.get("/api/v1/hub/website-builder").set(H);
    expect(res.body.data).toEqual({ siteId: await siteIdOf(admin, "central-stores"), slug: "central-stores" });
  });
});

describe("one-click deploy", () => {
  it("deploys the same modules under two different themes, each with only its selected visitors", async () => {
    const a = await deploy(admin, bodyFor("ocean-breeze", "flipkart", "ocean-breeze", { mode: "selected", roleId: "viewer", userIds: [USERS.storekeeper] }));
    expect(a.status).toBe(202);
    expect(a.body.data.path).toBe("/w/flipkart");
    expect((await waitForJob(admin, a.body.data.jobId)).status).toBe("succeeded");

    const b = await deploy(admin, bodyFor("ocean-breeze", "amazon", "coral-garden", { mode: "selected", roleId: "viewer", userIds: [] }));
    expect((await waitForJob(admin, b.body.data.jobId)).status).toBe("succeeded");

    const flipkart = (await admin.get(`/api/v1/sites/${await siteIdOf(admin, "flipkart")}/config`).set(H)).body.data.configuration as SiteConfiguration;
    const amazon = (await admin.get(`/api/v1/sites/${await siteIdOf(admin, "amazon")}/config`).set(H)).body.data.configuration as SiteConfiguration;
    expect(flipkart.modules.nodes.map((n) => n.moduleType)).toEqual(amazon.modules.nodes.map((n) => n.moduleType));
    expect([flipkart.website?.id, flipkart.shell]).toEqual(["ocean-breeze", "sidebar"]);
    expect([amazon.website?.id, amazon.shell, amazon.theme.primary]).toEqual(["coral-garden", "topbar", "#F97316"]);

    const listed = (await admin.get("/api/v1/hub/websites").set(H)).body.data as { slug: string; themeId: string; memberCount: number }[];
    expect(listed.find((w) => w.slug === "flipkart")).toMatchObject({ themeId: "ocean-breeze", memberCount: 2 });

    // Access control is membership: the selected storekeeper is in, the technician is not.
    const sk = await loginAs("storekeeper@opshub.local");
    const tech = await loginAs("technician@opshub.local");
    const flipkartId = await siteIdOf(admin, "flipkart");
    expect(await siteIdOf(sk, "flipkart")).toBe(flipkartId);
    expect(await siteIdOf(sk, "amazon")).toBeUndefined();
    expect((await tech.get(`/api/v1/sites/${flipkartId}/config`).set(H)).status).toBe(404);
  });

  it("keeps template settings tweaks and rejects an invalid graph without creating anything", async () => {
    const t = templates.find((x) => x.id === "ocean-breeze")!;
    const cfg = structuredClone(t.configuration) as SiteConfiguration;
    cfg.modules.nodes.find((n) => n.moduleType === "inventory")!.config.lowStockThreshold = 3;
    const ok = await deploy(admin, { ...bodyFor("ocean-breeze", "tweaked", "emerald-valley", { mode: "all", roleId: "viewer" }), configuration: cfg });
    expect((await waitForJob(admin, ok.body.data.jobId)).status).toBe("succeeded");
    const live = (await admin.get(`/api/v1/sites/${await siteIdOf(admin, "tweaked")}/config`).set(H)).body.data.configuration as SiteConfiguration;
    expect(live.modules.nodes.find((n) => n.moduleType === "inventory")!.config.lowStockThreshold).toBe(3);

    const broken = structuredClone(t.configuration) as SiteConfiguration;
    broken.modules.nodes.push({ id: "bogus", moduleType: "not-a-module" as never, position: { x: 0, y: 0 }, config: {} });
    const bad = await deploy(admin, { ...bodyFor("ocean-breeze", "broken-site", "ocean-breeze", { mode: "all", roleId: "viewer" }), configuration: broken });
    const result = await waitForJob(admin, bad.body.data.jobId);
    expect(result.status).toBe("failed");
    expect(await siteIdOf(admin, "broken-site")).toBeUndefined();
  });

  it("refuses a visitor role the configuration does not define", async () => {
    const res = await deploy(admin, bodyFor("ocean-breeze", "no-role", "ocean-breeze", { mode: "all", roleId: "technician" }));
    const result = await waitForJob(admin, res.body.data.jobId);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/visitor role/);
  });
});

describe("website access updates", () => {
  it("replaces visitors without touching administrators", async () => {
    const siteId = (await siteIdOf(admin, "flipkart"))!;
    const res = await admin.patch(`/api/v1/hub/websites/${siteId}/access`).set(H).send({ access: { mode: "selected", roleId: "viewer", userIds: [USERS.technician] } });
    expect(res.status).toBe(200);
    const entries = res.body.data as { userId: string; roles: string[] }[];
    expect(entries.map((e) => e.userId).sort()).toEqual([USERS.admin, USERS.technician].sort());
    expect(entries.find((e) => e.userId === USERS.admin)!.roles).toContain("admin");

    const sk = await loginAs("storekeeper@opshub.local");
    const tech = await loginAs("technician@opshub.local");
    expect(await siteIdOf(sk, "flipkart")).toBeUndefined();
    expect(await siteIdOf(tech, "flipkart")).toBe(siteId);
  });

  it("is limited to platform admins and to website sites", async () => {
    const siteId = (await siteIdOf(admin, "flipkart"))!;
    const tech = await loginAs("technician@opshub.local");
    expect((await tech.patch(`/api/v1/hub/websites/${siteId}/access`).set(H).send({ access: { mode: "all", roleId: "viewer" } })).status).toBe(403);
    const seeded = (await admin.get("/api/v1/sites").set(H)).body.data.find((s: { slug: string }) => s.slug === "central-stores").id;
    expect((await admin.patch(`/api/v1/hub/websites/${seeded}/access`).set(H).send({ access: { mode: "all", roleId: "viewer" } })).status).toBe(422);
  });
});
