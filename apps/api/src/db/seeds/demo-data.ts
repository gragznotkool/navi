import { eq } from "drizzle-orm";
import type pg from "pg";
import type { Tx } from "../scoped.js";
import * as s from "../schema/index.js";

/**
 * Deterministic operational demo data: 120 requests (34 Service Centre, 86 Distribution) with their
 * approvals, assignments, consumption, stock-ledger deductions and audit trail.
 *
 * Everything is derived from fixed UUIDs, a fixed epoch and a seeded PRNG, so counts, charts and
 * reports are identical on every run. Stock is simulated in time order first, so the final
 * `on_hand` of every SKU is, by construction, exactly SUM(stock_ledger.delta).
 */

const SITE_IDS = {
  "central-stores": "00000000-0000-4000-8000-000000000001",
  "service-centre": "00000000-0000-4000-8000-000000000002",
  distribution: "00000000-0000-4000-8000-000000000003",
} as const;
type SiteSlug = keyof typeof SITE_IDS;

const USER = {
  admin: "10000000-0000-4000-8000-000000000001",
  technician: "10000000-0000-4000-8000-000000000003",
  approver: "10000000-0000-4000-8000-000000000004",
  dispatcher: "10000000-0000-4000-8000-000000000005",
} as const;

/** Fixed-width deterministic UUID: namespace digit + sequence number. */
const uid = (ns: number, n: number): string => `${ns}0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const NS = { item: 3, request: 4, approval: 5, assignment: 6, consumption: 7, ledger: 8, audit: 9 } as const;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPOCH = Date.parse("2026-08-01T08:00:00Z");
const MIN = 60_000;

interface DemoSku {
  site: SiteSlug;
  sku: string;
  name: string;
  unit: string;
  open: number;
  reorder: number;
  cost: number;
  margin: number;
  maxReq: number;
}

export const DEMO_SKUS: readonly DemoSku[] = [
  // Central Stores
  { site: "central-stores", sku: "VLV-BALL-25", name: "Ball valve 25mm stainless", unit: "each", open: 150, reorder: 30, cost: 42.5, margin: 18, maxReq: 8 },
  { site: "central-stores", sku: "HYD-SEAL-40", name: "Hydraulic rod seal 40mm", unit: "each", open: 400, reorder: 80, cost: 6.8, margin: 32, maxReq: 20 },
  { site: "central-stores", sku: "CB-MCCB-100", name: "Moulded-case circuit breaker 100A", unit: "each", open: 60, reorder: 15, cost: 118, margin: 14, maxReq: 4 },
  { site: "central-stores", sku: "PMP-GEAR-02", name: "Gear pump 2cc", unit: "each", open: 24, reorder: 6, cost: 245, margin: 21, maxReq: 2 },
  { site: "central-stores", sku: "HOS-HYD-12", name: "Hydraulic hose 12mm", unit: "metre", open: 300, reorder: 60, cost: 9.4, margin: 27, maxReq: 30 },
  { site: "central-stores", sku: "VLV-SOL-24", name: "Solenoid valve 24V", unit: "each", open: 80, reorder: 20, cost: 67, margin: 19, maxReq: 5 },
  // Service Centre
  { site: "service-centre", sku: "TOOL-TORQ-01", name: "Torque wrench 20-100Nm", unit: "each", open: 40, reorder: 8, cost: 89, margin: 22, maxReq: 2 },
  { site: "service-centre", sku: "HYD-SEAL-40", name: "Hydraulic rod seal 40mm", unit: "each", open: 300, reorder: 60, cost: 6.8, margin: 32, maxReq: 12 },
  { site: "service-centre", sku: "BRG-6305", name: "Ball bearing 6305", unit: "each", open: 200, reorder: 40, cost: 11.2, margin: 25, maxReq: 10 },
  { site: "service-centre", sku: "CAP-ELEC-470", name: "Electrolytic capacitor 470uF", unit: "each", open: 500, reorder: 100, cost: 0.85, margin: 40, maxReq: 40 },
  { site: "service-centre", sku: "LUB-GRS-400", name: "Lithium grease cartridge 400g", unit: "each", open: 120, reorder: 24, cost: 4.3, margin: 30, maxReq: 12 },
  // Distribution
  { site: "distribution", sku: "PPE-HELM-01", name: "Safety helmet class E", unit: "each", open: 250, reorder: 50, cost: 14.5, margin: 35, maxReq: 15 },
  { site: "distribution", sku: "PPE-GLOV-L", name: "Cut-resistant gloves (L)", unit: "pair", open: 600, reorder: 120, cost: 3.9, margin: 38, maxReq: 40 },
  { site: "distribution", sku: "CB-MCB-32", name: "MCB 32A double pole", unit: "each", open: 200, reorder: 40, cost: 9.8, margin: 20, maxReq: 12 },
  { site: "distribution", sku: "TRF-SW-63", name: "Isolator switch 63A", unit: "each", open: 90, reorder: 20, cost: 31, margin: 17, maxReq: 6 },
  { site: "distribution", sku: "CBL-4C-6", name: "Cable 4-core 6mm", unit: "metre", open: 1500, reorder: 300, cost: 2.7, margin: 24, maxReq: 120 },
  { site: "distribution", sku: "VLV-GATE-50", name: "Gate valve 50mm", unit: "each", open: 70, reorder: 15, cost: 54, margin: 16, maxReq: 5 },
  { site: "distribution", sku: "PPE-VEST-HV", name: "High-visibility vest", unit: "each", open: 400, reorder: 80, cost: 5.1, margin: 33, maxReq: 25 },
];

/** Request mix per site; totals are the contract: 34 + 86 = 120. */
const PLAN: Record<"service-centre" | "distribution", { counts: Record<Status, number>; requester: string; assigner: string; recorder: string; notes: string[] }> = {
  "service-centre": {
    counts: { submitted: 6, approved: 5, assigned: 7, fulfilled: 12, rejected: 4 },
    requester: USER.technician,
    assigner: USER.admin,
    recorder: USER.technician,
    notes: ["Maintenance: press line 3 overhaul", "Tool sign-out for field repair", "Maintenance: gearbox service", "Tool sign-out: calibration bench", "Maintenance: hydraulic leak repair"],
  },
  distribution: {
    counts: { submitted: 14, approved: 12, assigned: 18, fulfilled: 34, rejected: 8 },
    requester: USER.dispatcher,
    assigner: USER.dispatcher,
    recorder: USER.dispatcher,
    notes: ["Dispatch order to north depot", "Store transfer to east substation", "Safety gear issue for new crew", "Dispatch order: feeder upgrade", "Store transfer: emergency restock"],
  },
};
type Status = "submitted" | "approved" | "assigned" | "fulfilled" | "rejected";

export interface DemoSummary {
  requests: number;
  skus: number;
  ledgerRows: number;
  auditEvents: number;
}

type Row<T extends { $inferInsert: unknown }> = T["$inferInsert"];

async function insertChunked<R>(rows: R[], write: (chunk: R[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += 400) await write(rows.slice(i, i + 400));
}

/** Idempotent: does nothing when the first deterministic request already exists. */
export async function seedDemoData(tx: Tx): Promise<DemoSummary | null> {
  const existing = await tx.select({ id: s.requests.id }).from(s.requests).where(eq(s.requests.id, uid(NS.request, 1))).limit(1);
  if (existing.length > 0) return null;

  const items: Row<typeof s.inventoryItems>[] = [];
  const ledger: Row<typeof s.stockLedger>[] = [];
  const requests: Row<typeof s.requests>[] = [];
  const requestLines: Row<typeof s.requestLines>[] = [];
  const approvals: Row<typeof s.approvals>[] = [];
  const assignments: Row<typeof s.assignments>[] = [];
  const consumption: Row<typeof s.consumptionRecords>[] = [];
  const audit: Row<typeof s.auditEvents>[] = [];
  const counters = { item: 0, request: 0, line: 0, approval: 0, assignment: 0, consumption: 0, ledger: 0, audit: 0 };
  const next = (k: keyof typeof counters) => uid(NS[k as keyof typeof NS] ?? 2, ++counters[k]);

  const stock = new Map<string, { id: string; sku: DemoSku; balance: number }>();
  for (const sku of DEMO_SKUS) {
    const id = next("item");
    stock.set(`${sku.site}:${sku.sku}`, { id, sku, balance: sku.open });
  }

  const addAudit = (siteId: string, actorId: string, action: string, entityType: string, entityId: string, at: number, metadata?: Record<string, unknown>) =>
    audit.push({ id: next("audit"), siteId, actorId, action, entityType, entityId, metadata: metadata ?? null, requestId: null, createdAt: new Date(at) });

  // ---- opening balances (one day before the first request)
  for (const e of stock.values()) {
    const siteId = SITE_IDS[e.sku.site];
    ledger.push({ id: next("ledger"), siteId, itemId: e.id, delta: e.sku.open, balanceAfter: e.sku.open, reason: "opening-balance", refType: "seed", refId: e.id, actorId: USER.admin, createdAt: new Date(EPOCH - 24 * 60 * MIN) });
  }

  // ---- requests, simulated in time order across both sites
  type Planned = { site: "service-centre" | "distribution"; status: Status; n: number };
  const planned: Planned[] = [];
  for (const site of ["service-centre", "distribution"] as const) {
    const rng = mulberry32(site === "service-centre" ? 1701 : 4242);
    const statuses = (Object.entries(PLAN[site].counts) as [Status, number][]).flatMap(([st, c]) => Array<Status>(c).fill(st));
    for (let i = statuses.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [statuses[i], statuses[j]] = [statuses[j]!, statuses[i]!];
    }
    statuses.forEach((status, n) => planned.push({ site, status, n }));
  }
  // Interleave sites by sequence number so ledger timestamps are globally ordered.
  planned.sort((a, b) => a.n - b.n || a.site.localeCompare(b.site));

  const rngQty = mulberry32(99);
  planned.forEach((p, seq) => {
    const plan = PLAN[p.site];
    const siteId = SITE_IDS[p.site];
    const siteSkus = DEMO_SKUS.filter((k) => k.site === p.site);
    const sku = siteSkus[(p.n * 7 + seq) % siteSkus.length]!;
    const entry = stock.get(`${p.site}:${sku.sku}`)!;
    let qty = 1 + Math.floor(rngQty() * sku.maxReq);
    let status = p.status;

    const created = EPOCH + seq * 53 * MIN;
    const decided = created + (20 + (seq % 90)) * MIN;
    const assigned = decided + (40 + (seq % 120)) * MIN;
    const consumed = assigned + (60 + (seq % 240)) * MIN;

    if ((status === "assigned" || status === "fulfilled") && entry.balance < qty) {
      if (entry.balance > 0) qty = entry.balance;
      else status = "approved"; // cannot allocate stock that does not exist
    }

    const requestId = next("request");
    const note = `${plan.notes[(seq + p.n) % plan.notes.length]} (#${p.n + 1})`;
    const lastTouch = status === "submitted" ? created : status === "approved" || status === "rejected" ? decided : status === "assigned" ? assigned : consumed;
    requests.push({ id: requestId, siteId, status, statusChangedAt: new Date(lastTouch), requestedBy: plan.requester, releaseVersion: 1, note, createdAt: new Date(created), updatedAt: new Date(lastTouch) });
    requestLines.push({ id: next("line"), siteId, requestId, itemId: entry.id, quantity: qty, extras: {} });
    addAudit(siteId, plan.requester, "request.submitted", "request", requestId, created);
    if (status === "submitted") return;

    const decision = status === "rejected" ? "rejected" : "approved";
    approvals.push({ id: next("approval"), siteId, requestId, decision, decidedBy: USER.approver, comment: decision === "rejected" ? "Rejected: not justified against current work orders" : null, decidedAt: new Date(decided) });
    addAudit(siteId, USER.approver, `request.${decision}`, "request", requestId, decided);
    if (status === "approved" || status === "rejected") return;

    const assignmentId = next("assignment");
    entry.balance -= qty;
    assignments.push({ id: assignmentId, siteId, requestId, quantity: qty, assignedBy: plan.assigner, createdAt: new Date(assigned) });
    ledger.push({ id: next("ledger"), siteId, itemId: entry.id, delta: -qty, balanceAfter: entry.balance, reason: "assignment", refType: "assignment", refId: assignmentId, actorId: plan.assigner, createdAt: new Date(assigned) });
    addAudit(siteId, plan.assigner, "assignment.created", "assignment", assignmentId, assigned, { requestId, quantity: qty, technicianId: p.site === "service-centre" ? USER.technician : null });
    if (status === "assigned") return;

    // Fulfilled: consumption sums to exactly the assigned quantity (split in two when possible).
    const first = qty > 1 && seq % 2 === 0 ? Math.ceil(qty / 2) : qty;
    for (const [i, part] of (first === qty ? [qty] : [first, qty - first]).entries()) {
      const consumptionId = next("consumption");
      const at = consumed - (i === 0 && first !== qty ? 30 * MIN : 0);
      consumption.push({ id: consumptionId, siteId, assignmentId, quantity: part, recordedBy: plan.recorder, createdAt: new Date(at) });
      addAudit(siteId, plan.recorder, "consumption.recorded", "consumption", consumptionId, at, { assignmentId, quantity: part });
    }
  });

  for (const e of stock.values()) {
    items.push({
      id: e.id,
      siteId: SITE_IDS[e.sku.site],
      sku: e.sku.sku,
      name: e.sku.name,
      unit: e.sku.unit,
      onHand: e.balance,
      reorderLevel: e.sku.reorder,
      unitCost: e.sku.cost.toFixed(2),
      vendorMargin: e.sku.margin.toFixed(2),
      extras: {},
      createdAt: new Date(EPOCH - 48 * 60 * MIN),
      updatedAt: new Date(EPOCH),
    });
  }

  // Parents before children (composite same-site FKs).
  await insertChunked(items, (c) => tx.insert(s.inventoryItems).values(c));
  await insertChunked(requests, (c) => tx.insert(s.requests).values(c));
  await insertChunked(requestLines, (c) => tx.insert(s.requestLines).values(c));
  await insertChunked(approvals, (c) => tx.insert(s.approvals).values(c));
  await insertChunked(assignments, (c) => tx.insert(s.assignments).values(c));
  await insertChunked(consumption, (c) => tx.insert(s.consumptionRecords).values(c));
  await insertChunked(ledger, (c) => tx.insert(s.stockLedger).values(c));
  await insertChunked(audit, (c) => tx.insert(s.auditEvents).values(c));

  return { requests: requests.length, skus: items.length, ledgerRows: ledger.length, auditEvents: audit.length };
}

/**
 * For EVERY SKU in EVERY site: SUM(stock_ledger.delta) must equal inventory_items.on_hand.
 * Throws (so the seed/build fails) on any discrepancy. Run with the admin pool (bypasses RLS).
 */
export async function assertLedgerBalance(pool: pg.Pool): Promise<number> {
  const bad = await pool.query<{ site_id: string; sku: string; on_hand: number; ledger_sum: number }>(
    `select i.site_id, i.sku, i.on_hand, coalesce(sum(l.delta), 0)::int as ledger_sum
       from inventory_items i left join stock_ledger l on l.item_id = i.id
      group by i.site_id, i.id, i.sku, i.on_hand
     having i.on_hand <> coalesce(sum(l.delta), 0)`,
  );
  if (bad.rows.length > 0) {
    const detail = bad.rows.map((r) => `${r.sku}: onHand=${r.on_hand} ledgerSum=${r.ledger_sum}`).join("; ");
    throw new Error(`Ledger imbalance detected: ${detail}`);
  }
  const total = await pool.query<{ n: number }>("select count(*)::int as n from inventory_items");
  return total.rows[0]?.n ?? 0;
}
