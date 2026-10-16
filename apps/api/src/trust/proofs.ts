import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ProofCell, ProofDefinition, ProofResult } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import { createDatabase, type Database, type Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { assignMaterial, InsufficientStock, type Actor } from "../services/operations.js";

/** Reserved system site (created by migration 0003). Proofs write only here, and only when `writesToLab`. */
export const TRUST_LAB_SITE_ID = "00000000-0000-4000-8000-0000000000aa";

export interface ProofContext {
  /** The API's normal application connection (the real `opshub_app` role in a healthy deployment). */
  db: Database;
  /** Used to open throwaway pools (size 1) for the connection-reuse proof. */
  connectionString: string;
  /** Platform admin who triggered the run; recorded as actor on lab fixtures. */
  actorId: string;
}

type Evidence = Record<string, string | number | boolean>;
interface Outcome {
  cells: ProofCell[];
  evidence: Evidence;
}
interface ProofDef extends ProofDefinition {
  run: (ctx: ProofContext) => Promise<Outcome>;
}

/** Thrown inside a transaction to roll it back while still returning a value. */
class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super("rollback");
  }
}

/** Runs `fn` in a lab-scoped transaction that is ALWAYS rolled back, so attack attempts can never persist. */
async function dryRun<T>(db: Database, fn: (tx: Tx) => Promise<T>, userId: string = randomUUID()): Promise<T> {
  try {
    await db.withTenant({ siteId: TRUST_LAB_SITE_ID, userId }, async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error("unreachable");
}

const errCode = (e: unknown): string => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code ?? "unknown";
};
const errText = (e: unknown): string => {
  const err = e as { message?: string; cause?: { message?: string } };
  return err.cause?.message ?? err.message ?? String(e);
};
const safeName = (n: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`unexpected table name ${n}`);
  return n;
};

/** Every table that carries tenant data: anything with a `site_id` column, plus `sites` itself. Discovered, not hard-coded. */
async function tenantTables(db: Database): Promise<{ name: string; keyColumn: string; rls: boolean; forced: boolean }[]> {
  const rows = await db.withoutTenant(async (tx) =>
    (
      await tx.execute<{ relname: string; has_site: boolean; rls: boolean; forced: boolean }>(sql`
        select c.relname,
               exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'site_id' and not a.attisdropped) as has_site,
               c.relrowsecurity as rls, c.relforcerowsecurity as forced
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
         order by c.relname`)
    ).rows,
  );
  return rows
    .filter((r) => r.has_site || r.relname === "sites")
    .map((r) => ({ name: safeName(r.relname), keyColumn: r.relname === "sites" ? "id" : "site_id", rls: r.rls, forced: r.forced }));
}

const actorFor = (ctx: ProofContext): Actor => ({ siteId: TRUST_LAB_SITE_ID, userId: ctx.actorId, requestId: `trust-${randomUUID()}` });

/** Creates a lab item with `onHand` units (and its opening-balance ledger row). */
async function labItem(tx: Tx, actorId: string, onHand: number): Promise<string> {
  const [item] = await tx.insert(s.inventoryItems).values({ siteId: TRUST_LAB_SITE_ID, sku: `PROOF-${randomUUID().slice(0, 8)}`, name: "Trust proof item", onHand }).returning({ id: s.inventoryItems.id });
  await tx.insert(s.stockLedger).values({ siteId: TRUST_LAB_SITE_ID, itemId: item!.id, delta: onHand, balanceAfter: onHand, reason: "opening-balance", refType: "trust-proof", refId: item!.id, actorId });
  return item!.id;
}

/** Creates `count` approved requests, each for `quantity` of `itemId`. */
async function approvedRequests(tx: Tx, actorId: string, itemId: string, count: number, quantity: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [r] = await tx.insert(s.requests).values({ siteId: TRUST_LAB_SITE_ID, status: "approved", requestedBy: actorId, releaseVersion: 1, note: "trust proof" }).returning({ id: s.requests.id });
    await tx.insert(s.requestLines).values({ siteId: TRUST_LAB_SITE_ID, requestId: r!.id, itemId, quantity });
    await tx.insert(s.approvals).values({ siteId: TRUST_LAB_SITE_ID, requestId: r!.id, decision: "approved", decidedBy: actorId });
    ids.push(r!.id);
  }
  return ids;
}

async function itemBalance(db: Database, itemId: string) {
  return db.withTenant({ siteId: TRUST_LAB_SITE_ID, userId: randomUUID() }, async (tx) => {
    const r = (await tx.execute<{ on_hand: number; ledger_sum: number; rows: number }>(sql`
      select i.on_hand, coalesce(sum(l.delta), 0)::int as ledger_sum, count(l.id)::int as rows
        from inventory_items i left join stock_ledger l on l.item_id = i.id where i.id = ${itemId} group by i.on_hand`)).rows[0]!;
    return { onHand: r.on_hand, ledgerSum: r.ledger_sum, ledgerRows: r.rows };
  });
}

const proofs: ProofDef[] = [
  {
    id: "role-privileges",
    title: "Application database role is least-privilege",
    description: "The API connects as a role that is not a superuser, cannot bypass row-level security, cannot run DDL and has no DELETE on any tenant table.",
    writesToLab: false,
    async run({ db }) {
      const role = await db.withoutTenant(async (tx) =>
        (await tx.execute<{ who: string; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(sql`select current_user as who, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`)).rows[0]!,
      );
      const tables = await tenantTables(db);
      const withDelete = await db.withoutTenant(async (tx) => {
        const out: string[] = [];
        for (const t of tables) {
          const r = (await tx.execute<{ ok: boolean }>(sql.raw(`select has_table_privilege(current_user, 'public.${t.name}', 'DELETE') as ok`))).rows[0]!;
          if (r.ok) out.push(t.name);
        }
        return out;
      });
      let ddl: string;
      try {
        await dryRun(db, (tx) => tx.execute(sql`create table trust_probe_ddl (i int)`));
        ddl = "DDL succeeded";
      } catch (e) {
        ddl = errCode(e) === "42501" ? "denied" : `unexpected error ${errCode(e)}`;
      }
      return {
        cells: [
          { label: "not a superuser", ok: !role.rolsuper, detail: `rolsuper = ${role.rolsuper}` },
          { label: "cannot bypass RLS", ok: !role.rolbypassrls, detail: `rolbypassrls = ${role.rolbypassrls}` },
          { label: "cannot create databases or roles", ok: !role.rolcreatedb && !role.rolcreaterole, detail: `createdb = ${role.rolcreatedb}, createrole = ${role.rolcreaterole}` },
          { label: "cannot run DDL", ok: ddl === "denied", detail: `CREATE TABLE → ${ddl}` },
          { label: "no DELETE on tenant tables", ok: withDelete.length === 0, detail: withDelete.length ? `DELETE allowed on: ${withDelete.join(", ")}` : `checked ${tables.length} tables` },
        ],
        evidence: { connectedAs: role.who, tablesChecked: tables.length },
      };
    },
  },
  {
    id: "no-context-zero-rows",
    title: "No tenant context → no rows",
    description: "With no site set on the connection, every tenant table returns zero rows.",
    writesToLab: false,
    async run({ db }) {
      const tables = await tenantTables(db);
      const cells: ProofCell[] = [];
      for (const t of tables) {
        const n = await db.withoutTenant(async (tx) => (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t.name}`))).rows[0]!.n);
        cells.push({ label: t.name, ok: n === 0, detail: `${n} rows visible without a site context; RLS ${t.rls ? "enabled" : "OFF"}${t.forced ? ", forced" : ""}` });
      }
      return { cells, evidence: { tablesChecked: tables.length } };
    },
  },
  {
    id: "cross-site-read",
    title: "A site cannot read another site's rows",
    description: "Connected as the lab site, count rows belonging to any other site, per table.",
    writesToLab: false,
    async run({ db }) {
      const tables = await tenantTables(db);
      const cells: ProofCell[] = [];
      for (const t of tables) {
        const n = await dryRun(db, async (tx) => (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t.name} where ${t.keyColumn} <> '${TRUST_LAB_SITE_ID}'`))).rows[0]!.n);
        cells.push({ label: t.name, ok: n === 0, detail: `${n} rows of other sites visible` });
      }
      return { cells, evidence: { tablesChecked: tables.length, labSite: "trust-lab" } };
    },
  },
  {
    id: "cross-site-write",
    title: "A site cannot modify another site's rows",
    description: "Connected as the lab site, attempt a no-op UPDATE of other sites' rows per table, a cross-site INSERT, and creating a site without being a platform admin (all rolled back).",
    writesToLab: false,
    async run({ db }) {
      const tables = await tenantTables(db);
      const cells: ProofCell[] = [];
      for (const t of tables) {
        let detail: string;
        let ok: boolean;
        try {
          const n = await dryRun(db, async (tx) => (await tx.execute(sql.raw(`update ${t.name} set ${t.keyColumn} = ${t.keyColumn} where ${t.keyColumn} <> '${TRUST_LAB_SITE_ID}'`))).rowCount ?? 0);
          ok = n === 0;
          detail = `${n} foreign rows touched`;
        } catch (e) {
          ok = errCode(e) === "42501";
          detail = ok ? "denied (no privilege / policy)" : `unexpected error ${errCode(e)}: ${errText(e)}`;
        }
        cells.push({ label: `${t.name} (update)`, ok, detail });
      }
      const foreign = randomUUID();
      let ins: ProofCell;
      try {
        await dryRun(db, (tx) => tx.insert(s.inventoryItems).values({ siteId: foreign, sku: "PROOF-X", name: "cross-site insert attempt" }));
        ins = { label: "inventory_items (insert)", ok: false, detail: "insert into another site succeeded" };
      } catch (e) {
        const msg = errText(e);
        ins = { label: "inventory_items (insert)", ok: errCode(e) === "42501" && /row-level security/i.test(msg), detail: `rejected: ${msg}` };
      }
      cells.push(ins);
      let mk: ProofCell;
      try {
        await dryRun(db, (tx) => tx.insert(s.sites).values({ id: randomUUID(), slug: `proof-${randomUUID().slice(0, 8)}`, name: "non-admin site creation attempt" }));
        mk = { label: "sites (create as non-admin)", ok: false, detail: "a non-admin user created a site" };
      } catch (e) {
        const msg = errText(e);
        mk = { label: "sites (create as non-admin)", ok: errCode(e) === "42501" && /row-level security/i.test(msg), detail: `rejected: ${msg}` };
      }
      cells.push(mk);
      return { cells, evidence: { tablesChecked: tables.length } };
    },
  },
  {
    id: "append-only",
    title: "Ledger, audit and release history cannot be altered",
    description: "UPDATE and DELETE on the stock ledger, audit events and releases are refused (always rolled back).",
    writesToLab: false,
    async run({ db }) {
      const cells: ProofCell[] = [];
      for (const table of ["stock_ledger", "audit_events", "site_releases"]) {
        for (const stmt of [`update ${table} set id = id`, `delete from ${table}`]) {
          let ok: boolean;
          let detail: string;
          try {
            const n = await dryRun(db, async (tx) => (await tx.execute(sql.raw(stmt))).rowCount ?? 0);
            ok = n === 0;
            detail = ok ? "no rows affected" : `${n} rows changed`;
          } catch (e) {
            ok = ["42501", "23001"].includes(errCode(e));
            detail = ok ? `refused (${errCode(e) === "42501" ? "no privilege" : "immutability trigger"})` : `unexpected error ${errCode(e)}: ${errText(e)}`;
          }
          cells.push({ label: `${table} (${stmt.split(" ")[0]})`, ok, detail });
        }
      }
      return { cells, evidence: {} };
    },
  },
  {
    id: "connection-reuse",
    title: "Tenant context never leaks between pooled connections",
    description: "Uses a pool of ONE connection reused for many different sites, then checks nothing remains set.",
    writesToLab: false,
    async run({ connectionString }) {
      const tmp = createDatabase(connectionString, 1);
      try {
        const rounds = 30;
        let inside = 0;
        for (let i = 0; i < rounds; i++) {
          const site = randomUUID();
          const seen = await tmp.withTenant({ siteId: site, userId: randomUUID() }, async (tx) => (await tx.execute<{ v: string | null }>(sql`select current_setting('app.current_site_id', true) as v`)).rows[0]!.v);
          if (seen === site) inside++;
        }
        let leaked = 0;
        let rowsSeen = 0;
        for (let i = 0; i < rounds; i++) {
          const v = await tmp.withoutTenant(async (tx) => (await tx.execute<{ v: string | null }>(sql`select current_setting('app.current_site_id', true) as v`)).rows[0]!.v);
          if (v) leaked++;
          rowsSeen += await tmp.withoutTenant(async (tx) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from inventory_items`)).rows[0]!.n);
        }
        return {
          cells: [
            { label: "context is correct inside each transaction", ok: inside === rounds, detail: `${inside}/${rounds} matched` },
            { label: "no context after the transaction ends", ok: leaked === 0, detail: `${leaked}/${rounds} later queries still had a site set` },
            { label: "no rows visible on the reused connection", ok: rowsSeen === 0, detail: `${rowsSeen} inventory rows seen without context` },
          ],
          evidence: { poolSize: 1, rounds },
        };
      } finally {
        await tmp.close();
      }
    },
  },
  {
    id: "concurrent-allocation",
    title: "50 simultaneous allocations against 10 units",
    description: "Creates a lab item with 10 units and 50 approved requests, allocates them all at once through the real service, and checks stock and ledger.",
    writesToLab: true,
    async run(ctx) {
      const units = 10;
      const attempts = 50;
      const a = actorFor(ctx);
      const { itemId, requests } = await ctx.db.withTenant({ siteId: TRUST_LAB_SITE_ID, userId: ctx.actorId }, async (tx) => {
        const itemId = await labItem(tx, ctx.actorId, units);
        return { itemId, requests: await approvedRequests(tx, ctx.actorId, itemId, attempts, 1) };
      });
      const t0 = performance.now();
      const results = await Promise.allSettled(requests.map((id, i) => assignMaterial(ctx.db, a, id, `proof-${itemId}-${i}`)));
      const ms = Math.round(performance.now() - t0);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const insufficient = results.filter((r) => r.status === "rejected" && (r.reason as unknown) instanceof InsufficientStock).length;
      const other = attempts - ok - insufficient;
      const bal = await itemBalance(ctx.db, itemId);
      return {
        cells: [
          { label: `exactly ${units} allocations succeed`, ok: ok === units, detail: `${ok} of ${attempts} succeeded` },
          { label: `${attempts - units} are rejected as insufficient stock`, ok: insufficient === attempts - units && other === 0, detail: `${insufficient} insufficient-stock, ${other} other failures` },
          { label: "stock never goes negative", ok: bal.onHand === 0, detail: `on hand after = ${bal.onHand}` },
          { label: "ledger reconciles with stock", ok: bal.ledgerSum === bal.onHand, detail: `ledger sum ${bal.ledgerSum} vs on hand ${bal.onHand}` },
          { label: "one ledger row per success", ok: bal.ledgerRows === units + 1, detail: `${bal.ledgerRows} rows (1 opening balance + ${bal.ledgerRows - 1} allocations)` },
        ],
        evidence: { attempts, units, succeeded: ok, rejected: insufficient, otherFailures: other, durationMs: ms },
      };
    },
  },
  {
    id: "idempotent-retry",
    title: "Retrying an allocation creates only one stock movement",
    description: "Sends the same allocation 20 times concurrently with the same idempotency key.",
    writesToLab: true,
    async run(ctx) {
      const calls = 20;
      const a = actorFor(ctx);
      const { itemId, requestId } = await ctx.db.withTenant({ siteId: TRUST_LAB_SITE_ID, userId: ctx.actorId }, async (tx) => {
        const itemId = await labItem(tx, ctx.actorId, 100);
        return { itemId, requestId: (await approvedRequests(tx, ctx.actorId, itemId, 1, 3))[0]! };
      });
      const key = `proof-idem-${itemId}`;
      const results = await Promise.allSettled(Array.from({ length: calls }, () => assignMaterial(ctx.db, a, requestId, key)));
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof assignMaterial>>> => r.status === "fulfilled");
      const applied = fulfilled.filter((r) => !r.value.replayed).length;
      const bal = await itemBalance(ctx.db, itemId);
      return {
        cells: [
          { label: "exactly one call applies the allocation", ok: applied === 1, detail: `${applied} applied, ${fulfilled.length - applied} replayed, ${calls - fulfilled.length} failed` },
          { label: "exactly one stock movement", ok: bal.ledgerRows === 2, detail: `${bal.ledgerRows} ledger rows (opening + allocation)` },
          { label: "stock reduced once", ok: bal.onHand === 97, detail: `on hand = ${bal.onHand} (expected 97)` },
        ],
        evidence: { calls, applied, onHand: bal.onHand },
      };
    },
  },
];

export const proofDefinitions: ProofDefinition[] = proofs.map(({ id, title, description, writesToLab }) => ({ id, title, description, writesToLab }));

const notRun = (proofId: string): ProofResult => ({ proofId, status: "not-run", ranAt: null, durationMs: null, cells: [], evidence: {}, error: null });
const last = new Map<string, ProofResult>();
const running = new Set<string>();

export const lastResult = (id: string): ProofResult => last.get(id) ?? notRun(id);

export class ProofBusy extends Error {}
export class UnknownProof extends Error {}

/** Executes one proof live. Status is derived from what the run observed; nothing is pre-seeded as passing. */
export async function runProof(id: string, ctx: ProofContext): Promise<ProofResult> {
  const def = proofs.find((p) => p.id === id);
  if (!def) throw new UnknownProof(id);
  if (running.has(id)) throw new ProofBusy(id);
  running.add(id);
  const started = performance.now();
  let result: ProofResult;
  try {
    const out = await def.run(ctx);
    result = {
      proofId: id,
      status: out.cells.length > 0 && out.cells.every((c) => c.ok) ? "pass" : "fail",
      ranAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      cells: out.cells,
      evidence: out.evidence,
      error: null,
    };
  } catch (e) {
    result = { proofId: id, status: "error", ranAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), cells: [], evidence: {}, error: errText(e) };
  } finally {
    running.delete(id);
  }
  last.set(id, result);
  try {
    await ctx.db.withTenant({ siteId: TRUST_LAB_SITE_ID, userId: ctx.actorId }, (tx) =>
      recordAudit(tx, { siteId: TRUST_LAB_SITE_ID, actorId: ctx.actorId, action: "trust.proof-run", entityType: "trust_proof", entityId: id, metadata: { status: result.status, failedCells: result.cells.filter((c) => !c.ok).length } }),
    );
  } catch {
    // Auditing must not change a proof's verdict.
  }
  return result;
}
