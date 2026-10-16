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
    const sku = `ML-${Math.random().toString(36).slice(2, 10)}`;
    const item = (await admin.query("insert into inventory_items (site_id, sku, name, on_hand) values ($1,$2,'test',$3) returning id", [SITES.distribution, sku, onHand])).rows[0];
    await admin.query("insert into stock_ledger (site_id,item_id,delta,balance_after,reason,ref_type,ref_id) values ($1,$2,$3,$3,'opening-balance','seed',$2)", [SITES.distribution, item.id, onHand]);
    return item.id as string;
  } finally {
    await admin.end();
  }
}

/** Inserts an approved request whose lines are listed in the GIVEN order. */
async function approvedRequest(lines: { itemId: string; quantity: number }[]): Promise<string> {
  const admin = adminPool();
  try {
    const r = (await admin.query("insert into requests (site_id,status,requested_by,release_version) values ($1,'approved',$2,1) returning id", [SITES.distribution, USERS.dispatcher])).rows[0];
    for (const l of lines) await admin.query("insert into request_lines (site_id,request_id,item_id,quantity) values ($1,$2,$3,$4)", [SITES.distribution, r.id, l.itemId, l.quantity]);
    await admin.query("insert into approvals (site_id,request_id,decision,decided_by) values ($1,$2,'approved',$3)", [SITES.distribution, r.id, USERS.approver]);
    return r.id as string;
  } finally {
    await admin.end();
  }
}

async function itemState(itemId: string) {
  const admin = adminPool();
  try {
    const item = (await admin.query("select on_hand from inventory_items where id = $1", [itemId])).rows[0];
    const ledger = (await admin.query("select coalesce(sum(delta),0)::int s, count(*)::int n from stock_ledger where item_id = $1", [itemId])).rows[0];
    return { onHand: item.on_hand as number, ledgerSum: ledger.s as number, ledgerRows: ledger.n as number };
  } finally {
    await admin.end();
  }
}

describe("multi-line allocation", () => {
  it("allocates every line in one transaction with one ledger row per line, pinned to the config version", async () => {
    const a = await newItem(10);
    const b = await newItem(10);
    const requestId = await approvedRequest([
      { itemId: a, quantity: 3 },
      { itemId: b, quantity: 4 },
    ]);
    const { assignment } = await assignMaterial(db, actor, requestId, `ml-ok-${a}`);
    expect(assignment.quantity).toBe(7);
    expect(await itemState(a)).toMatchObject({ onHand: 7, ledgerSum: 7, ledgerRows: 2 });
    expect(await itemState(b)).toMatchObject({ onHand: 6, ledgerSum: 6, ledgerRows: 2 });
    const admin = adminPool();
    const rows = (await admin.query("select config_version, ref_type from stock_ledger where reason = 'assignment' and item_id in ($1,$2)", [a, b])).rows;
    const asg = (await admin.query("select config_version from assignments where id = $1", [assignment.id])).rows[0];
    await admin.end();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ config_version: 1, ref_type: "request_line" });
    expect(asg.config_version).toBe(1);
  });

  it("rolls back every line when any one line is short", async () => {
    const a = await newItem(10);
    const b = await newItem(1);
    const requestId = await approvedRequest([
      { itemId: a, quantity: 5 },
      { itemId: b, quantity: 2 },
    ]);
    await expect(assignMaterial(db, actor, requestId, `ml-short-${a}`)).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await itemState(a)).toMatchObject({ onHand: 10, ledgerRows: 1 });
    expect(await itemState(b)).toMatchObject({ onHand: 1, ledgerRows: 1 });
    const admin = adminPool();
    const status = (await admin.query("select status from requests where id = $1", [requestId])).rows[0];
    await admin.end();
    expect(status.status).toBe("approved");
  });

  it("retrying with the same idempotency key creates no second movement", async () => {
    const a = await newItem(10);
    const b = await newItem(10);
    const requestId = await approvedRequest([
      { itemId: a, quantity: 2 },
      { itemId: b, quantity: 2 },
    ]);
    const key = `ml-idem-${a}`;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => assignMaterial(db, actor, requestId, key)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await itemState(a)).toMatchObject({ onHand: 8, ledgerRows: 2 });
    expect(await itemState(b)).toMatchObject({ onHand: 8, ledgerRows: 2 });
  });

  it("opposing item orders under concurrency cause no deadlocks", async () => {
    const a = await newItem(1000);
    const b = await newItem(1000);
    const requests: string[] = [];
    for (let i = 0; i < 20; i++) {
      requests.push(
        await approvedRequest(
          i % 2 === 0
            ? [
                { itemId: a, quantity: 1 },
                { itemId: b, quantity: 1 },
              ]
            : [
                { itemId: b, quantity: 1 },
                { itemId: a, quantity: 1 },
              ],
        ),
      );
    }
    const results = await Promise.allSettled(requests.map((id, i) => assignMaterial(db, actor, id, `ml-dead-${a}-${i}`)));
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures.map((f) => String((f as PromiseRejectedResult).reason))).toEqual([]);
    expect(await itemState(a)).toMatchObject({ onHand: 980, ledgerSum: 980 });
    expect(await itemState(b)).toMatchObject({ onHand: 980, ledgerSum: 980 });
  });
});
