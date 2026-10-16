import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProofList, ProofResult } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import { createDatabase, type Database } from "../../src/db/scoped.js";
import { proofDefinitions, runProof } from "../../src/trust/proofs.js";
import { adminPool, adminUrl, appDb, appUrl, freshDatabase, USERS } from "../support/db.js";

const H = { "x-opshub-client": "web" };
let app: Express;
let db: Database;

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  return agent;
}

beforeAll(async () => {
  await freshDatabase();
  db = appDb(15);
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

async function demoRowCounts() {
  const pool = adminPool();
  try {
    const q = async (t: string) => (await pool.query(`select count(*)::int n from ${t} where site_id <> '00000000-0000-4000-8000-0000000000aa'`)).rows[0].n as number;
    return { items: await q("inventory_items"), requests: await q("requests"), ledger: await q("stock_ledger"), assignments: await q("assignments") };
  } finally {
    await pool.end();
  }
}

describe("live trust proofs (as the real application role)", () => {
  it("lists every proof as 'not-run' before anything has been executed", async () => {
    const admin = await loginAs("admin@opshub.local");
    const res = await admin.get("/api/v1/trust/proofs");
    expect(res.status).toBe(200);
    const list = res.body.data as ProofList;
    expect(list.proofs.map((p) => p.definition.id)).toEqual(proofDefinitions.map((d) => d.id));
    for (const p of list.proofs) expect(p.last).toMatchObject({ status: "not-run", ranAt: null, cells: [] });
    expect(list.environment.databaseRole).toBe("opshub_app");
    expect(list.environment.nodeEnv).toBe("test");
  });

  it("only platform admins may list or run proofs", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    expect((await keeper.get("/api/v1/trust/proofs")).status).toBe(403);
    expect((await keeper.post("/api/v1/trust/proofs/role-privileges/run").set(H)).status).toBe(403);
    expect((await request(app).get("/api/v1/trust/proofs")).status).toBe(401);
  });

  it("rejects an unknown proof id", async () => {
    const admin = await loginAs("admin@opshub.local");
    expect((await admin.post("/api/v1/trust/proofs/does-not-exist/run").set(H)).status).toBe(404);
  });

  it("every proof passes, with evidence, and never touches the demo sites", async () => {
    const admin = await loginAs("admin@opshub.local");
    const before = await demoRowCounts();
    const results: Record<string, ProofResult> = {};
    for (const d of proofDefinitions) {
      const res = await admin.post(`/api/v1/trust/proofs/${d.id}/run`).set(H);
      expect(res.status, d.id).toBe(200);
      results[d.id] = res.body.data as ProofResult;
      const failing = results[d.id]!.cells.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
      expect(failing, `${d.id} failing cells`).toEqual([]);
      expect(results[d.id]!.status, `${d.id}: ${results[d.id]!.error ?? ""}`).toBe("pass");
      expect(results[d.id]!.cells.length).toBeGreaterThan(0);
      expect(results[d.id]!.durationMs).not.toBeNull();
    }
    expect(await demoRowCounts()).toEqual(before);

    // Coverage is discovered from the catalog, so newer tables like request_lines are included.
    const labels = results["no-context-zero-rows"]!.cells.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["request_lines", "inventory_items", "stock_ledger", "sites", "audit_events"]));

    // The numbers behind the headline claim are the real ones.
    expect(results["concurrent-allocation"]!.evidence).toMatchObject({ attempts: 50, units: 10, succeeded: 10, rejected: 40, otherFailures: 0 });
    expect(results["idempotent-retry"]!.evidence).toMatchObject({ calls: 20, applied: 1, onHand: 97 });

    // After running, the list reflects the stored results.
    const list = (await admin.get("/api/v1/trust/proofs")).body.data as ProofList;
    expect(list.proofs.every((p) => p.last.status === "pass")).toBe(true);
  });

  it("records each run in the lab site's audit log", async () => {
    const pool = adminPool();
    const n = (await pool.query("select count(*)::int n from audit_events where action = 'trust.proof-run'")).rows[0].n as number;
    await pool.end();
    expect(n).toBeGreaterThanOrEqual(proofDefinitions.length);
  });
});

describe("proofs go red when protections are broken", () => {
  it("connecting as a superuser (RLS bypassed) fails the role, no-context and cross-site proofs", async () => {
    const broken = createDatabase(adminUrl(), 15);
    try {
      const ctx = { db: broken, connectionString: adminUrl(), actorId: USERS.admin };
      const role = await runProof("role-privileges", ctx);
      expect(role.status).toBe("fail");
      expect(role.cells.find((c) => c.label === "not a superuser")?.ok).toBe(false);
      expect(role.cells.find((c) => c.label === "cannot bypass RLS")?.ok).toBe(false);

      const none = await runProof("no-context-zero-rows", ctx);
      expect(none.status).toBe("fail");
      expect(none.cells.find((c) => c.label === "inventory_items")?.ok).toBe(false);

      const read = await runProof("cross-site-read", ctx);
      expect(read.status).toBe("fail");
      expect(read.cells.find((c) => c.label === "inventory_items")?.ok).toBe(false);
    } finally {
      await broken.close();
    }
  });
});
