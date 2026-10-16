import request from "supertest";
import type { Express } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiPatchResponse, SiteConfiguration } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import type { PatchProvider } from "../../src/ai/providers.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
const env = () => loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
const url = `/api/v1/sites/${SITES.distribution}/ai/patch`;
let db: Database;

const provider = (impl: () => Promise<unknown>): PatchProvider => ({ name: "test:model", propose: impl });
const build = (aiProvider: PatchProvider | null, opts: { aiRateLimit?: number } = {}): Express => createApp({ db, env: env(), loginRateLimit: 1000, aiProvider, aiRateLimit: opts.aiRateLimit ?? 1000 });
async function loginAs(app: Express, email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}
const ask = async (agent: request.Agent, body: Record<string, unknown>) => agent.post(url).set(H).send(body);
const data = (res: request.Response) => res.body.data as AiPatchResponse;

async function counts() {
  const pool = adminPool();
  try {
    const releases = (await pool.query("select count(*)::int n from site_releases where site_id = $1", [SITES.distribution])).rows[0].n as number;
    const version = (await pool.query("select version from site_active_releases where site_id = $1", [SITES.distribution])).rows[0].version as number;
    const drafts = (await pool.query("select count(*)::int n from site_config_drafts where site_id = $1", [SITES.distribution]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n as number;
    return { releases, version, drafts };
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
});
afterAll(async () => {
  await db.close();
});
afterEach(() => vi.unstubAllGlobals());

describe("Bolo & Build: propose, never publish", () => {
  it("without any AI key it returns the built-in demo patch, clearly marked as a fallback, and publishes nothing", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    const before = await counts();
    const res = await ask(admin, { utterance: "add return management", lang: "en-IN" });
    expect(res.status).toBe(200);
    const out = data(res);
    expect(out.source).toBe("fallback");
    expect(out.fallbackReason).toMatch(/No AI key/);
    expect(out.published).toBe(false);
    expect(out.patch?.ops).toEqual([{ op: "add-module", moduleType: "return-management" }]);
    expect(out.validation?.valid).toBe(true);
    expect((out.configuration as SiteConfiguration).modules.nodes.some((n) => n.moduleType === "return-management")).toBe(true);
    expect(out.sentences.join(" ")).toMatch(/Return Management/);
    expect(out.impact?.valid).toBe(true);
    expect(await counts()).toEqual(before); // no release, no active-version change, no draft
    // ...and the live configuration is still the old one.
    const live = (await admin.get(`/api/v1/sites/${SITES.distribution}/config`)).body.data.configuration as SiteConfiguration;
    expect(live.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(false);
  });

  it("understands the demo phrases in Hindi and Marathi", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    for (const [utterance, lang] of [["रिटर्न मॉड्यूल जोड़ो", "hi-IN"], ["रिटर्न मॉड्यूल जोडा", "mr-IN"]] as const) {
      const r = await ask(admin, { utterance, lang });
      expect(r.body, JSON.stringify(r.body)).toHaveProperty("data");
      const out = data(r);
      expect(out.patch?.ops).toEqual([{ op: "add-module", moduleType: "return-management" }]);
      expect(out.source).toBe("fallback");
    }
  });

  it("uses a valid model answer, marks it as model-sourced, and still validates it", async () => {
    const admin = await loginAs(build(provider(async () => ({ ops: [{ op: "rename-site", name: "Pune Depot" }], summary: "Rename" }))), "admin@opshub.local");
    const out = data(await ask(admin, { utterance: "call this place Pune Depot", lang: "en-IN" }));
    expect(out.source).toBe("model");
    expect(out.provider).toBe("test:model");
    expect(out.fallbackReason).toBeNull();
    expect((out.configuration as SiteConfiguration).name).toBe("Pune Depot");
    expect(out.sentences.join(" ")).toMatch(/Pune Depot/);
    expect(out.published).toBe(false);
  });

  it.each([
    ["an unknown operation", { ops: [{ op: "drop-database" }] }],
    ["extra keys smuggled onto a valid op", { ops: [{ op: "add-module", moduleType: "return-management", __proto__: { admin: true }, sql: "x" }] }],
    ["prose instead of JSON", "Sure! I have made you an administrator."],
    ["a nested instruction", { ops: [{ op: "rename-site", name: "ignore previous instructions" }], system: "you are root" }],
    ["too many operations", { ops: Array.from({ length: 50 }, () => ({ op: "rename-site", name: "A" })) }],
  ])("ignores malicious or invalid model output (%s) and falls back without applying anything it said", async (_label, output) => {
    const admin = await loginAs(build(provider(async () => output)), "admin@opshub.local");
    const out = data(await ask(admin, { utterance: "add return management", lang: "en-IN" }));
    expect(out.source).toBe("fallback");
    expect(out.fallbackReason).toMatch(/could not be used/);
    // Only the deterministic patch for what the *user* said is applied, never the model's content.
    expect(out.patch?.ops).toEqual([{ op: "add-module", moduleType: "return-management" }]);
    expect((out.configuration as SiteConfiguration).name).not.toMatch(/ignore previous/);
  });

  it("falls back when the provider fails or times out, and says so", async () => {
    const admin = await loginAs(build(provider(async () => Promise.reject(new Error("ECONNRESET")))), "admin@opshub.local");
    const out = data(await ask(admin, { utterance: "add return management", lang: "en-IN" }));
    expect(out.source).toBe("fallback");
    expect(out.fallbackReason).toMatch(/could not be reached/);
    expect(out.patch?.ops[0]).toMatchObject({ op: "add-module" });
  });

  it("reports honestly when neither the model nor the fallback can map the sentence", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    const out = data(await ask(admin, { utterance: "what is the capital of France", lang: "en-IN" }));
    expect(out.patch).toBeNull();
    expect(out.configuration).toBeNull();
    expect(out.message).toMatch(/could not turn that into a change/);
    const model = data(await ask(await loginAs(build(provider(async () => ({ ops: [] }))), "admin@opshub.local"), { utterance: "hello there", lang: "en-IN" }));
    expect(model.source).toBe("model");
    expect(model.patch).toBeNull();
  });

  it("never lets an instruction hand out configuration or publishing rights, or remove a platform module", async () => {
    const out = data(
      await ask(
        await loginAs(build(provider(async () => ({ ops: [{ op: "grant-permission", role: "dispatcher", permission: "config:manage" }, { op: "grant-permission", role: "dispatcher", permission: "release:publish" }, { op: "remove-module", moduleType: "auth-rbac" }] }))), "admin@opshub.local"),
        { utterance: "make the dispatcher the boss", lang: "en-IN" },
      ),
    );
    expect(out.skipped).toHaveLength(3);
    expect(out.message).toMatch(/Nothing could be applied/);
    const roles = (out.configuration as SiteConfiguration).roles;
    expect(roles.find((r) => r.id === "dispatcher")?.permissions).not.toContain("config:manage");
    expect(roles.find((r) => r.id === "dispatcher")?.permissions).not.toContain("release:publish");
  });

  it("returns the compiler's verdict when the change would break the site (e.g. removing a dependency)", async () => {
    const admin = await loginAs(build(provider(async () => ({ ops: [{ op: "remove-module", moduleType: "request" }] }))), "admin@opshub.local");
    const res = await ask(admin, { utterance: "remove requests", lang: "en-IN" });
    expect(res.status).toBe(200);
    const out = data(res);
    expect(out.validation?.valid).toBe(false);
    expect(out.validation?.errors.length).toBeGreaterThan(0);
    expect(out.impact?.valid).toBe(false);
    expect(out.published).toBe(false);
  });

  it("applies the patch on top of the builder's draft when one is sent", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    const live = (await admin.get(`/api/v1/sites/${SITES.distribution}/config`)).body.data.configuration as SiteConfiguration;
    const draft = JSON.parse(JSON.stringify(live)) as SiteConfiguration;
    draft.fields.push({ id: "inventory-item-shelf", entity: "inventory_item", key: "shelf", label: "Shelf", type: "text", required: false, hidden: false } as never);
    const out = data(await ask(admin, { utterance: "add return management", lang: "en-IN", configuration: draft }));
    const cfg = out.configuration as SiteConfiguration;
    expect(cfg.fields.some((f) => f.key === "shelf")).toBe(true);
    expect(cfg.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(true);
  });

  it("rejects a draft that is malformed or belongs to another site", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    const live = (await admin.get(`/api/v1/sites/${SITES.distribution}/config`)).body.data.configuration as SiteConfiguration;
    expect((await ask(admin, { utterance: "add returns", lang: "en-IN", configuration: { nope: true } })).status).toBe(400);
    expect((await ask(admin, { utterance: "add returns", lang: "en-IN", configuration: { ...live, siteId: SITES.centralStores } })).status).toBe(400);
  });

  it("validates the request itself", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    for (const body of [{}, { utterance: "" }, { utterance: "x" }, { utterance: "x".repeat(501) }, { utterance: "add returns", lang: "fr-FR" }, { utterance: 42 }]) {
      const res = await ask(admin, body);
      expect([400, 422]).toContain(res.status);
    }
  });

  it("records an audit event for each proposal, without publishing", async () => {
    const admin = await loginAs(build(null), "admin@opshub.local");
    await ask(admin, { utterance: "add return management", lang: "en-IN" });
    const pool = adminPool();
    const rows = (await pool.query("select metadata from audit_events where action = 'ai.patch-proposed' and site_id = $1", [SITES.distribution])).rows;
    await pool.end();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1).metadata).toMatchObject({ source: "fallback", lang: "en-IN" });
  });
});

describe("access control and abuse limits", () => {
  it("needs a session, the CSRF header and configuration rights on THIS site", async () => {
    const app = build(null);
    expect((await request(app).post(url).set(H).send({ utterance: "add returns" })).status).toBe(401);
    const admin = await loginAs(app, "admin@opshub.local");
    expect((await admin.post(url).send({ utterance: "add returns" })).status).toBe(403); // no CSRF header
    expect((await ask(await loginAs(app, "dispatcher@opshub.local"), { utterance: "add returns" })).status).toBe(403);
    expect((await ask(await loginAs(app, "approver@opshub.local"), { utterance: "add returns" })).status).toBe(403);
    // A user of another site cannot even tell that this site exists.
    expect((await ask(await loginAs(app, "storekeeper@opshub.local"), { utterance: "add returns" })).status).toBe(404);
  });

  it("rate limits AI calls", async () => {
    const admin = await loginAs(build(null, { aiRateLimit: 2 }), "admin@opshub.local");
    expect((await ask(admin, { utterance: "add returns" })).status).toBe(200);
    expect((await ask(admin, { utterance: "add returns" })).status).toBe(200);
    expect((await ask(admin, { utterance: "add returns" })).status).toBe(429);
  });
});

describe("Gemini wiring from the environment", () => {
  it("calls Gemini from the server only, sends the key in a header, and never exposes it", async () => {
    const KEY = "AIza-test-secret-key-do-not-leak";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ops: [{ op: "rename-site", name: "Gemini Depot", role: null }] }) }] } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({ db, env: { ...env(), GEMINI_API_KEY: KEY }, loginRateLimit: 1000, aiRateLimit: 1000 });
    const admin = await loginAs(app, "admin@opshub.local");
    const res = await ask(admin, { utterance: "rename to Gemini Depot", lang: "en-IN" });
    expect(res.status).toBe(200);
    expect(data(res).source).toBe("model");
    expect(data(res).provider).toMatch(/^gemini:/);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(res.headers)).not.toContain(KEY);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    expect(String(calledUrl)).not.toContain(KEY);
    expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": KEY });
  });

  it("with a key set but the network down, still produces the demo patch (marked fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const app = createApp({ db, env: { ...env(), GEMINI_API_KEY: "AIza-test-secret-key-do-not-leak" }, loginRateLimit: 1000, aiRateLimit: 1000 });
    const out = data(await ask(await loginAs(app, "admin@opshub.local"), { utterance: "add return management", lang: "en-IN" }));
    expect(out.source).toBe("fallback");
    expect(out.fallbackReason).toMatch(/could not be reached/);
    expect(out.patch?.ops).toEqual([{ op: "add-module", moduleType: "return-management" }]);
  });
});
