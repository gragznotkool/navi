import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReleaseSummary, SiteConfiguration } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;
const base = `/api/v1/sites/${SITES.distribution}`;

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  return agent;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const current = async (a: request.Agent) => (await a.get(`${base}/config`)).body.data as { version: number; configuration: SiteConfiguration };
const releases = async (a: request.Agent) => (await a.get(`${base}/releases`)).body.data as ReleaseSummary[];

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

describe("release history for Rewind", () => {
  it("builds a three-release history and explains each release in plain English", async () => {
    const admin = await loginAs("admin@opshub.local");

    // v2: add a field.
    let { version, configuration } = await current(admin);
    let next = clone(configuration);
    next.fields.push({ id: "item-shelf", entity: "inventory_item", key: "shelf", label: "Shelf", type: "text", required: false, hidden: false });
    expect((await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version, configuration: next, note: "Add shelf" })).status).toBe(201);

    // v3: approval deadline of 10 seconds.
    ({ version, configuration } = await current(admin));
    next = clone(configuration);
    next.modules.nodes.find((n) => n.moduleType === "approval")!.config["slaSeconds"] = 10;
    expect((await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version, configuration: next, note: "SLA 10s" })).status).toBe(201);

    // v4: hide the field (destructive only when rows hold data; none do here).
    ({ version, configuration } = await current(admin));
    next = clone(configuration);
    next.fields.find((f) => f.key === "shelf")!.hidden = true;
    expect((await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version, configuration: next })).status).toBe(201);

    const list = await releases(admin);
    expect(list.map((r) => r.version)).toEqual([4, 3, 2, 1]);
    expect(list.filter((r) => r.isActive).map((r) => r.version)).toEqual([4]);
    expect(list[0]!.publishedByName).toBe("Platform Admin");

    const sentences: Record<number, string[]> = {};
    for (const r of list) sentences[r.version] = (await admin.get(`${base}/releases/${r.id}/summary`)).body.data.sentences;
    expect(sentences[1]).toEqual(expect.arrayContaining([expect.stringMatching(/^This is the first release for “/)]));
    expect(sentences[2]).toEqual(["A new text field “Shelf” is added to inventory items."]);
    expect(sentences[3]).toEqual(["Setting “slaSeconds” on “Approval” changes from not set to 10."].length ? [expect.stringMatching(/Pending approval requests now turn overdue after 10 seconds\./)] : []);
    expect(sentences[4]).toEqual(["The “Shelf” field is hidden on inventory items. No saved values are affected."]);
  });

  it("returns a historical release's full configuration, read-only, for the preview", async () => {
    const admin = await loginAs("admin@opshub.local");
    const list = await releases(admin);
    const v2 = list.find((r) => r.version === 2)!;
    const res = await admin.get(`${base}/releases/${v2.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.release).toMatchObject({ version: 2, isActive: false });
    expect(res.body.data.configuration.fields.map((f: { key: string }) => f.key)).toEqual(["shelf"]);
    expect(res.body.data.configuration.fields[0].hidden).toBe(false); // as it was in v2
    // Fetching history never changes the active release.
    expect((await current(admin)).version).toBe(4);
  });

  it("previewing a rewind shows what going back would do now (impact for a target version)", async () => {
    const admin = await loginAs("admin@opshub.local");
    const res = await admin.post(`${base}/releases/impact`).set(H).send({ baseVersion: 4, targetVersion: 2 });
    expect(res.status).toBe(200);
    const text = res.body.data.sentences.join(" ");
    expect(text).toMatch(/Shelf” field is shown again/);
    expect(text).toMatch(/no longer have a deadline/);
    expect(res.body.data.impact.destructive).toBe(false);
  });

  it("rewinding to an earlier version creates a new release and keeps all history", async () => {
    const admin = await loginAs("admin@opshub.local");
    const res = await admin.post(`${base}/releases/rollback`).set(H).send({ baseVersion: 4, targetVersion: 2 });
    expect(res.status).toBe(201);
    const list = await releases(admin);
    expect(list.map((r) => r.version)).toEqual([5, 4, 3, 2, 1]);
    expect(list[0]).toMatchObject({ rolledBackToVersion: 2, isActive: true });
    const cfg = (await current(admin)).configuration;
    expect(cfg.fields[0]!.hidden).toBe(false);
    expect(cfg.modules.nodes.find((n) => n.moduleType === "approval")!.config["slaSeconds"]).toBeUndefined();
  });

  it("release details need config:manage and never cross sites", async () => {
    const dispatcher = await loginAs("dispatcher@opshub.local"); // member of distribution, no config:manage
    const admin = await loginAs("admin@opshub.local");
    const id = (await releases(admin))[0]!.id;
    expect((await dispatcher.get(`${base}/releases/${id}`)).status).toBe(403);
    // A release id from distribution requested under another site's path is simply not found.
    expect((await admin.get(`/api/v1/sites/${SITES.centralStores}/releases/${id}`)).status).toBe(404);
    expect((await admin.get(`${base}/releases/not-a-uuid`)).status).toBe(404);
  });
});
