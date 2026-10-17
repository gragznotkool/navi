import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/scoped.js";
import { assignMaterial, type Actor } from "../../src/services/operations.js";
import { adminPool, appDb, freshDatabase, SITES, USERS } from "../support/db.js";

let db: Database;
const actor: Actor = { siteId: SITES.distribution, userId: USERS.dispatcher, requestId: "test-request" };

beforeAll(async () => {
  await freshDatabase();
  db = appDb(20);
});
afterAll(async () => {
  await db.close();
});

async function newItem(onHand: number): Promise<string> {
  const admin = adminPool();
  try {
    const sku = `TEST-${Math.random().toString(36).slice(2, 10)}`;
    const item = (await admin.query("insert into inventory_items (site_id, sku, name, on_hand) values ($1,$2,'test',$3) returning id", [SITES.distribution, sku, onHand])).rows[0];
    if (onHand > 0) {
      await admin.query("insert into stock_ledger (site_id,item_id,delta,balance_after,reason,ref_type,ref_id) values ($1,$2,$3,$3,'opening-balance','seed',$2)", [SITES.distribution, item.id, onHand]);
    }
    return item.id as string;
  } finally {
    await admin.end();
  }
}

async function approvedRequests(itemId: string, count: number, quantity = 1): Promise<string[]> {
  const admin = adminPool();
  try {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const r = (await admin.query("insert into requests (site_id,status,requested_by,release_version) values ($1,'approved',$2,1) returning id", [SITES.distribution, USERS.dispatcher])).rows[0];
      await admin.query("insert into request_lines (site_id,request_id,item_id,quantity) values ($1,$2,$3,$4)", [SITES.distribution, r.id, itemId, quantity]);
      await admin.query("insert into approvals (site_id,request_id,decision,decided_by) values ($1,$2,'approved',$3)", [SITES.distribution, r.id, USERS.approver]);
      ids.push(r.id as string);
    }
    return ids;
  } finally {
    await admin.end();
  }
}

async function snapshot(itemId: string) {
  const admin = adminPool();
  try {
    const item = (await admin.query("select on_hand from inventory_items where id = $1", [itemId])).rows[0];
    const ledger = (await admin.query("select coalesce(sum(delta),0)::int s, count(*)::int n from stock_ledger where item_id = $1", [itemId])).rows[0];
    const assignments = (await admin.query("select count(*)::int n from assignments a join requests r on r.id = a.request_id join request_lines rl on rl.request_id = r.id where rl.item_id = $1", [itemId])).rows[0];
    return { onHand: item.on_hand as number, ledgerSum: ledger.s as number, ledgerRows: ledger.n as number, assignments: assignments.n as number };
  } finally {
    await admin.end();
  }
}

describe("inventory correctness under concurrency", () => {
  it("50 competing allocations against 10 units: exactly 10 succeed, stock never negative, ledger reconciles", async () => {
    const itemId = await newItem(10);
    const requests = await approvedRequests(itemId, 50);
    const results = await Promise.allSettled(requests.map((id, i) => assignMaterial(db, actor, id, `concurrent-key-${itemId}-${i}`)));

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(40);
    expect(failed.every((f) => (f.reason as { code?: string }).code === "insufficient_stock")).toBe(true);

    const snap = await snapshot(itemId);
    expect(snap.onHand).toBe(0);
    expect(snap.assignments).toBe(10);
    expect(snap.ledgerSum).toBe(0); // 10 opening - 10 assigned
    expect(snap.ledgerRows).toBe(11);
    expect(snap.onHand).toBe(snap.ledgerSum);
  });

  it("50 concurrent retries of ONE request with the same idempotency key allocate exactly once", async () => {
    const itemId = await newItem(100);
    const [requestId] = await approvedRequests(itemId, 1, 7);
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => assignMaterial(db, actor, requestId!, `same-key-${itemId}`)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof assignMaterial>>> => r.status === "fulfilled");
    expect(new Set(fulfilled.map((r) => r.value.assignment.id)).size).toBe(1);
    expect(fulfilled.filter((r) => !r.value.replayed)).toHaveLength(1);

    const snap = await snapshot(itemId);
    expect(snap.onHand).toBe(93);
    expect(snap.assignments).toBe(1);
    expect(snap.ledgerRows).toBe(2);
  });

  it("50 concurrent attempts on one request with DIFFERENT keys allocate exactly once", async () => {
    const itemId = await newItem(100);
    const [requestId] = await approvedRequests(itemId, 1, 3);
    const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => assignMaterial(db, actor, requestId!, `diff-key-${itemId}-${i}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const snap = await snapshot(itemId);
    expect(snap.onHand).toBe(97);
    expect(snap.assignments).toBe(1);
  });

  it("a failed allocation rolls back everything (no ledger row, assignment, status change or idempotency key)", async () => {
    const itemId = await newItem(2);
    const [requestId] = await approvedRequests(itemId, 1, 5);
    await expect(assignMaterial(db, actor, requestId!, `rollback-key-${itemId}`)).rejects.toMatchObject({ code: "insufficient_stock" });
    const snap = await snapshot(itemId);
    expect(snap).toMatchObject({ onHand: 2, ledgerSum: 2, ledgerRows: 1, assignments: 0 });
    const admin = adminPool();
    const req = (await admin.query("select status from requests where id = $1", [requestId])).rows[0];
    const keys = (await admin.query("select count(*)::int n from idempotency_keys where key = $1", [`rollback-key-${itemId}`])).rows[0];
    await admin.end();
    expect(req.status).toBe("approved");
    expect(keys.n).toBe(0);
  });

  it("refuses to allocate for a request that is not approved", async () => {
    const itemId = await newItem(10);
    const admin = adminPool();
    const r = (await admin.query("insert into requests (site_id,status,requested_by,release_version) values ($1,'submitted',$2,1) returning id", [SITES.distribution, USERS.dispatcher])).rows[0];
    await admin.query("insert into request_lines (site_id,request_id,item_id,quantity) values ($1,$2,$3,1)", [SITES.distribution, r.id, itemId]);
    await admin.end();
    await expect(assignMaterial(db, actor, r.id, `unapproved-${itemId}`)).rejects.toMatchObject({ code: "invalid_transition" });
    expect((await snapshot(itemId)).onHand).toBe(10);
  });

  it("every seeded and test item reconciles with the ledger", async () => {
    const admin = adminPool();
    const rows = (await admin.query("select sku, on_hand, ledger_sum from stock_reconciliation where not reconciled")).rows;
    await admin.end();
    expect(rows).toEqual([]);
  });
});
