import { createHash } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, appUrl, freshDatabase } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  // Access tokens live 3 seconds here so expiry can be exercised for real.
  const base = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env: { ...base, JWT_EXPIRES_IN_SECONDS: 3 }, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

const cookieOf = (res: request.Response, name: string): string | undefined =>
  (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith(`${name}=`));
const valueOf = (setCookie: string): string => setCookie.split(";")[0]!.split("=").slice(1).join("=");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(email = "storekeeper@opshub.local") {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  return { agent, refresh: valueOf(cookieOf(res, "opshub_refresh")!) };
}
/** A request that carries an explicit refresh cookie (no cookie jar), to replay captured tokens. */
const refreshWith = (token: string) => request(app).post("/api/v1/auth/refresh").set(H).set("Cookie", `opshub_refresh=${token}`);

describe("login issues a short-lived access cookie and a scoped refresh cookie", () => {
  it("sets httpOnly cookies, with the refresh cookie restricted to the auth path and SameSite=Strict", async () => {
    const res = await request(app).post("/api/v1/auth/login").set(H).send({ email: "storekeeper@opshub.local", password: DEV_PASSWORD });
    const access = cookieOf(res, "opshub_session")!;
    const refresh = cookieOf(res, "opshub_refresh")!;
    expect(access).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth(;|$)/);
    expect(refresh).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toContain(valueOf(refresh)); // never in the body
  });

  it("stores only a hash of the refresh token", async () => {
    const { refresh } = await login();
    const pool = adminPool();
    const rows = (await pool.query("select token_hash from refresh_tokens")).rows.map((r) => r.token_hash as string);
    await pool.end();
    expect(rows).toContain(createHash("sha256").update(refresh).digest("hex"));
    expect(rows).not.toContain(refresh);
  });
});

describe("expiry → refresh → retry", () => {
  it("an expired access token is rejected, a refresh restores access, and the rotated cookie keeps working", async () => {
    const { agent } = await login();
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    await sleep(4200); // access token (3 s) has expired
    const expired = await agent.get("/api/v1/auth/me");
    expect(expired.status).toBe(401);

    const refreshed = await agent.post("/api/v1/auth/refresh").set(H);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.user.email).toBe("storekeeper@opshub.local");
    expect(refreshed.body.data.memberships.length).toBeGreaterThan(0);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200); // retry succeeds with the new access cookie

    // Rotation: the cookie jar now holds a new refresh token, which also works.
    expect((await agent.post("/api/v1/auth/refresh").set(H)).status).toBe(200);
  });
});

describe("refresh token rotation and reuse detection", () => {
  it("each refresh token works once; replaying an old one is rejected and revokes the whole family", async () => {
    const first = await login();
    const rotated = await refreshWith(first.refresh);
    expect(rotated.status).toBe(200);
    const second = valueOf(cookieOf(rotated, "opshub_refresh")!);
    expect(second).not.toBe(first.refresh);

    // Attacker (or stale tab) replays the first token.
    const replay = await refreshWith(first.refresh);
    expect(replay.status).toBe(401);
    expect(cookieOf(replay, "opshub_refresh")).toMatch(/Expires=Thu, 01 Jan 1970/); // cookie is cleared

    // The legitimate newer token is now dead too: the family was revoked.
    expect((await refreshWith(second)).status).toBe(401);

    const pool = adminPool();
    const n = (await pool.query("select count(*)::int n from audit_events where action = 'auth.refresh-reuse-detected'")).rows[0].n as number;
    await pool.end();
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("reuse by one user does not disturb another user's session", async () => {
    const a = await login("storekeeper@opshub.local");
    const b = await login("dispatcher@opshub.local");
    await refreshWith(a.refresh);
    expect((await refreshWith(a.refresh)).status).toBe(401); // reuse
    expect((await refreshWith(b.refresh)).status).toBe(200); // b untouched
  });

  it("two simultaneous refreshes with the same token cannot both succeed", async () => {
    const { refresh } = await login();
    const results = await Promise.all([refreshWith(refresh), refreshWith(refresh)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});

describe("logout and invalid refresh attempts", () => {
  it("logout kills the refresh token as well as the access token", async () => {
    const { agent, refresh } = await login();
    expect((await agent.post("/api/v1/auth/logout").set(H)).status).toBe(204);
    expect((await refreshWith(refresh)).status).toBe(401);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("rejects missing, garbage and expired refresh tokens with the same 401", async () => {
    expect((await request(app).post("/api/v1/auth/refresh").set(H)).status).toBe(401);
    expect((await refreshWith("not-a-real-token")).status).toBe(401);
    expect((await refreshWith("x".repeat(500))).status).toBe(401);

    const { refresh } = await login();
    const pool = adminPool();
    await pool.query("update refresh_tokens set expires_at = now() - interval '1 minute' where token_hash = $1", [createHash("sha256").update(refresh).digest("hex")]);
    await pool.end();
    const expired = await refreshWith(refresh);
    expect(expired.status).toBe(401);
    expect(expired.body.error.message).toBe("Session expired. Sign in again."); // no hint why
  });

  it("requires the CSRF client header", async () => {
    const { refresh } = await login();
    const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", `opshub_refresh=${refresh}`);
    expect(res.status).toBe(403);
    // And the token was not consumed by the rejected request.
    expect((await refreshWith(refresh)).status).toBe(200);
  });

  it("a refresh token cannot be used as an access token", async () => {
    const { refresh } = await login();
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", `opshub_session=${refresh}`);
    expect(res.status).toBe(401);
  });
});
