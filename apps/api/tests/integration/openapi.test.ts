import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import type { Database } from "../../src/db/scoped.js";
import { manifest } from "../../src/routes/manifest.js";
import { appDb, appUrl, freshDatabase } from "../support/db.js";

let app: Express;
let db: Database;
beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  app = createApp({ db, env: loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv), loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

describe("OpenAPI description", () => {
  it("is public and describes exactly the routes the server registers", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = res.body as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe("3.1.0");
    const documented = new Set(Object.entries(doc.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)));
    const registered = new Set(manifest.map((r) => `${r.method} ${r.path.replace(/:([A-Za-z]+)/g, "{$1}")}`));
    registered.add("POST /api/public/{slug}/requests");
    expect([...registered].filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((r) => !registered.has(r))).toEqual([]);
    expect(documented.size).toBeGreaterThan(50);
  });

  it("documents request bodies, idempotency keys and which routes need no session", async () => {
    const doc = (await request(app).get("/api/v1/openapi.json")).body as { paths: Record<string, Record<string, { requestBody?: unknown; parameters?: { name: string }[]; security?: unknown[] }>> };
    expect(doc.paths["/api/v1/sites/{siteId}/inventory/{itemId}/adjust"]!.post!.requestBody).toBeDefined();
    expect(doc.paths["/api/v1/sites/{siteId}/inventory/{itemId}/adjust"]!.post!.parameters!.map((p) => p.name)).toContain("Idempotency-Key");
    expect(doc.paths["/api/public/{slug}/requests"]!.post!.security).toEqual([]);
    expect(doc.paths["/api/v1/auth/login"]!.post!.security).toEqual([]);
    expect(doc.paths["/api/v1/sites/{siteId}/members"]!.get!.security).toBeUndefined(); // needs the session cookie
  });

  it("nothing documented is secretly open: every other route refuses an anonymous caller", async () => {
    const doc = (await request(app).get("/api/v1/openapi.json")).body as { paths: Record<string, Record<string, { security?: unknown[] }>> };
    const guarded = Object.entries(doc.paths).flatMap(([p, ms]) => Object.entries(ms).filter(([, op]) => op.security === undefined).map(([m]) => ({ m, p })));
    const id = "00000000-0000-4000-8000-000000000001";
    for (const { m, p } of guarded.filter((g) => g.m === "get")) {
      const url = p.replace(/\{\w+\}/g, id);
      if (url.endsWith("/events")) continue; // SSE: covered by the provisioning tests
      const res = await request(app).get(url);
      expect([401, 404], `${m} ${p} -> ${res.status}`).toContain(res.status);
    }
  });
});
