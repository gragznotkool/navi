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
const base = `/api/v1/sites/${SITES.centralStores}`;

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  return agent;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const current = async (agent: request.Agent) => (await agent.get(`${base}/config`)).body.data as { version: number; configuration: SiteConfiguration };

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: process.env.TEST_APP_URL!, JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

describe("configured fields at runtime", () => {
  it("serves visible field values on items", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const items = (await keeper.get(`${base}/inventory`)).body.data.items as { sku: string; extras: Record<string, unknown> }[];
    expect(items.find((i) => i.sku === "BRG-6204")?.extras).toEqual({ price: 180 });
  });

  it("validates values against the field type and rejects unknown fields", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const item = ((await keeper.get(`${base}/inventory`)).body.data.items as { id: string; sku: string }[]).find((i) => i.sku === "GSK-KIT-A")!;
    const wrongType = await keeper.patch(`${base}/inventory/${item.id}`).set(H).send({ extras: { price: "cheap" } });
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.code).toBe("invalid_fields");
    const unknown = await keeper.patch(`${base}/inventory/${item.id}`).set(H).send({ extras: { colour: "red" } });
    expect(unknown.status).toBe(422);
    const proto = await keeper.patch(`${base}/inventory/${item.id}`).set(H).type("json").send('{"extras": {"__proto__": 1, "constructor": 2}}');
    expect(proto.status).toBe(422);
    const ok = await keeper.patch(`${base}/inventory/${item.id}`).set(H).send({ extras: { price: 99.5 } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.extras).toEqual({ price: 99.5 });
  });

  it("users outside the site cannot edit its items", async () => {
    const approver = await loginAs("approver@opshub.local"); // not a member of central-stores
    const res = await approver.patch(`${base}/inventory/00000000-0000-4000-8000-000000000001`).set(H).send({ extras: { price: 1 } });
    expect(res.status).toBe(404);
  });
});

describe("impact preview, confirmation and soft-hide", () => {
  const hidePrice = (cfg: SiteConfiguration) => {
    const c = clone(cfg);
    c.fields.find((f) => f.key === "price")!.hidden = true;
    return c;
  };

  it("previews hiding a field with real row counts and flags it as needing confirmation", async () => {
    const admin = await loginAs("admin@opshub.local");
    const { version, configuration } = await current(admin);
    const res = await admin.post(`${base}/releases/impact`).set(H).send({ baseVersion: version, configuration: hidePrice(configuration) });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.impact.fieldsHidden).toEqual([{ entity: "inventory_item", key: "price", label: "Unit price", rowsWithData: 3 }]);
    expect(res.body.data.impact.destructive).toBe(true);
    expect(res.body.data.sentences.join(" ")).toMatch(/Unit price.*hidden.*3 rows keep the saved value/);
  });

  it("publishing a destructive change needs confirmDestructive; hidden values stay stored and return on rollback", async () => {
    const admin = await loginAs("admin@opshub.local");
    const keeper = await loginAs("storekeeper@opshub.local");
    const { version, configuration } = await current(admin);
    const hidden = hidePrice(configuration);

    const refused = await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version, configuration: hidden });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("destructive_confirmation_required");
    expect((await current(admin)).version).toBe(version);

    const published = await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version, configuration: hidden, confirmDestructive: true });
    expect(published.status).toBe(201);

    // Hidden: not served...
    const during = (await keeper.get(`${base}/inventory`)).body.data.items as { extras: Record<string, unknown> }[];
    expect(during.every((i) => Object.keys(i.extras).length === 0)).toBe(true);
    // ...but kept in the database.
    const pool = adminPool();
    const stored = (await pool.query("select count(*)::int n from inventory_items where site_id = $1 and jsonb_exists(extras, 'price')", [SITES.centralStores])).rows[0];
    await pool.end();
    expect(stored.n).toBe(3);

    // Rolling back to the previous version restores the field with its values.
    const rolledBack = await admin.post(`${base}/releases/rollback`).set(H).send({ baseVersion: version + 1, targetVersion: version });
    expect(rolledBack.status).toBe(201);
    const after = (await keeper.get(`${base}/inventory`)).body.data.items as { sku: string; extras: Record<string, unknown> }[];
    expect(after.find((i) => i.sku === "BRG-6204")?.extras).toEqual({ price: 180 });
  });

  it("a non-destructive change (adding a field) publishes without confirmation and is described in plain English", async () => {
    const admin = await loginAs("admin@opshub.local");
    const { version, configuration } = await current(admin);
    const next = clone(configuration);
    next.fields.push({ id: "item-shelf", entity: "inventory_item", key: "shelf", label: "Shelf", type: "text", required: false, hidden: false });
    const preview = await admin.post(`${base}/releases/impact`).set(H).send({ baseVersion: version, configuration: next });
    expect(preview.body.data.impact.destructive).toBe(false);
    expect(preview.body.data.sentences).toContain("A new text field “Shelf” is added to inventory items.");
    const res = await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version, configuration: next });
    expect(res.status).toBe(201);
  });

  it("a stale base version returns 409 with a plain-English account of what changed", async () => {
    const admin = await loginAs("admin@opshub.local");
    const { version, configuration } = await current(admin);
    const res = await admin.post(`${base}/releases/publish`).set(H).send({ baseVersion: version - 1, configuration });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("stale_draft");
    expect(res.body.error.message).toMatch(/Since then:.*Shelf/);
  });

  it("rollback preview reports what would be undone, and the summary endpoint explains a release", async () => {
    const admin = await loginAs("admin@opshub.local");
    const { version } = await current(admin);
    const preview = await admin.post(`${base}/releases/impact`).set(H).send({ baseVersion: version, targetVersion: 1 });
    expect(preview.status).toBe(200);
    expect(preview.body.data.impact.fieldsRemoved).toEqual([{ entity: "inventory_item", key: "shelf", label: "Shelf", rowsWithData: 0 }]);
    const releases = (await admin.get(`${base}/releases`)).body.data as { id: string; version: number }[];
    const latest = releases.find((r) => r.version === version)!;
    const summary = await admin.get(`${base}/releases/${latest.id}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.sentences.length).toBeGreaterThan(0);
  });

  it("impact preview is not available to non-publishers", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const { configuration } = await current(keeper);
    const res = await keeper.post(`${base}/releases/impact`).set(H).send({ baseVersion: 1, configuration });
    expect(res.status).toBe(403);
  });
});
