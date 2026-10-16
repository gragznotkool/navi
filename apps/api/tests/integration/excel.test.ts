import ExcelJS from "exceljs";
import JSZip from "jszip";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportReport } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, appUrl, freshDatabase, SITES } from "../support/db.js";

const H = { "x-opshub-client": "web" };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let app: Express;
let db: Database;
const central = `/api/v1/sites/${SITES.centralStores}`;
const dist = `/api/v1/sites/${SITES.distribution}`;

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: appUrl(), JWT_SECRET: "x".repeat(40), WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});

async function loginAs(email: string) {
  const agent = request.agent(app);
  expect((await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD })).status).toBe(200);
  return agent;
}
const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

async function readSheet(buf: Buffer, name?: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return name ? wb.getWorksheet(name)! : wb.worksheets[0]!;
}

async function makeXlsx(rows: unknown[][], sheetName = "Inventory"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let keySeq = 0;
const newKey = () => `import-key-${Date.now()}-${++keySeq}`;
const upload = (agent: request.Agent, file: Buffer | string, opts: { dryRun?: boolean; key?: string | null; site?: string } = {}) => {
  const dry = opts.dryRun ?? true;
  let r = agent.post(`${opts.site ?? central}/imports/inventory?dryRun=${dry}`).set(H).set("content-type", XLSX);
  if (!dry && opts.key !== null) r = r.set("idempotency-key", opts.key ?? newKey());
  return r.send(file);
};
const report = (res: request.Response) => res.body.data as ImportReport;

async function db_(sql: string, params: unknown[] = []) {
  const pool = adminPool();
  try {
    return (await pool.query(sql, params)).rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}
const stockOf = async (sku: string) => (await db_("select on_hand, id from inventory_items where site_id = $1 and sku = $2", [SITES.centralStores, sku]))[0] as { on_hand: number; id: string } | undefined;
const ledgerCount = async () => (await db_("select count(*)::int n from stock_ledger where site_id = $1", [SITES.centralStores]))[0]!.n as number;
const itemCount = async () => (await db_("select count(*)::int n from inventory_items where site_id = $1", [SITES.centralStores]))[0]!.n as number;

const HEAD = ["SKU", "Name", "Unit", "On hand", "Reorder level", "Unit price"];

describe("export", () => {
  it("exports the caller's site as a real .xlsx with the site's visible fields", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const res = await binary(keeper.get(`${central}/reports/inventory.xlsx`));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="central-stores-inventory.xlsx"');
    expect(res.headers["cache-control"]).toBe("no-store");
    const ws = await readSheet(res.body as Buffer, "Inventory");
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(HEAD);
    const skus = ws.getColumn(1).values.slice(2);
    expect(skus).toContain("BRG-6204");
    expect(ws.rowCount - 1).toBe(await itemCount());
    const first = ws.getRow(2);
    expect(typeof first.getCell(4).value).toBe("number"); // quantities stay numbers
  });

  it("neutralizes formula-injection payloads in every text cell it writes", async () => {
    const payloads = ["=HYPERLINK(\"http://evil\",\"x\")", "+1+1", "-2+3", "@SUM(A1:A9)", "\t=1+1", "\r=1+1", "=cmd|' /C calc'!A0"];
    const pool = adminPool();
    try {
      for (const [i, p] of payloads.entries()) {
        await pool.query("insert into inventory_items (site_id, sku, name, unit, on_hand, reorder_level, extras) values ($1, $2, $3, $4, 1, 0, '{}')", [SITES.centralStores, `INJ-${i}`, p, p.slice(0, 18)]);
      }
    } finally {
      await pool.end();
    }
    const keeper = await loginAs("storekeeper@opshub.local");
    const res = await binary(keeper.get(`${central}/reports/inventory.xlsx`));
    const ws = await readSheet(res.body as Buffer);
    for (let i = 0; i < payloads.length; i++) {
      const row = ws.getRows(2, ws.rowCount)!.find((r) => r.getCell(1).value === `INJ-${i}`)!;
      for (const col of [2, 3]) {
        const c = row.getCell(col);
        expect(c.type, `payload ${i}`).toBe(ExcelJS.ValueType.String);
        // (XML normalizes a carriage return to a newline; what matters is the leading apostrophe and the string type.)
        const norm = (t: string) => t.split(String.fromCharCode(13)).join(String.fromCharCode(10));
        const expected = col === 2 ? payloads[i]! : payloads[i]!.slice(0, 18);
        expect(norm(String(c.value))).toBe(norm(`'${expected}`));
        expect(c.formula).toBeUndefined();
      }
    }
    // And the raw package contains no formula elements at all.
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(xml).not.toMatch(/<f[ >]/);
  });

  it("exports requests (one row per line) only for sites the caller can see", async () => {
    const admin = await loginAs("admin@opshub.local");
    const res = await binary(admin.get(`${dist}/reports/requests.xlsx`));
    expect(res.status).toBe(200);
    const ws = await readSheet(res.body as Buffer, "Requests");
    expect((ws.getRow(1).values as unknown[]).slice(1, 9)).toEqual(["Request", "Status", "Created", "Status changed", "Config version", "SKU", "Item", "Quantity"]);
  });

  it("denies exports across sites, without a session, and without the permission", async () => {
    expect((await request(app).get(`${central}/reports/inventory.xlsx`)).status).toBe(401);
    const keeper = await loginAs("storekeeper@opshub.local");
    expect((await keeper.get(`${dist}/reports/inventory.xlsx`)).status).toBe(404); // not a member: the site does not exist for them
    expect((await keeper.get(`${dist}/reports/requests.xlsx`)).status).toBe(404);
    const dispatcher = await loginAs("dispatcher@opshub.local");
    expect((await dispatcher.get(`${central}/reports/inventory.xlsx`)).status).toBe(404);
    expect((await dispatcher.get(`${dist}/reports/inventory.xlsx`)).status).toBe(403); // member, but no inventory:view
    expect((await keeper.get(`${central}/reports/requests.xlsx`)).status).toBe(403); // member, but no request:view
  });
});

describe("import: dry run", () => {
  it("reports exactly what would change and writes nothing", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const before = { items: await itemCount(), ledger: await ledgerCount(), brg: await stockOf("BRG-6204") };
    const file = await makeXlsx([HEAD, ["BRG-6204", null, null, before.brg!.on_hand + 25, null, 99], ["NEW-001", "New widget", "box", 40, 5, 12.5], ["NEW-002", "Second widget"]]);
    const res = await upload(keeper, file);
    expect(res.status).toBe(200);
    const r = report(res);
    expect(r).toMatchObject({ dryRun: true, applied: false, replayed: false, fileErrors: [] });
    expect(r.totals).toMatchObject({ rows: 3, create: 2, update: 1, unchanged: 0, errors: 0, stockChanges: 2 });
    const upd = r.rows.find((x) => x.sku === "BRG-6204")!;
    expect(upd.action).toBe("update");
    expect(upd.changes.join(" ")).toMatch(/On hand: \d+ to \d+ \(\+25, recorded in the stock ledger\)/);
    expect(upd.changes.join(" ")).toMatch(/Unit price: .* to 99/);
    expect(r.rows.find((x) => x.sku === "NEW-001")!.changes[0]).toMatch(/New item “New widget” with 40 box in stock/);
    expect(r.rows.find((x) => x.sku === "NEW-002")!.action).toBe("create");
    // Nothing was written.
    expect({ items: await itemCount(), ledger: await ledgerCount(), brg: await stockOf("BRG-6204") }).toEqual(before);
  });

  it("is the default: an import without dryRun=false never writes", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const file = await makeXlsx([HEAD, ["DEFAULT-DRY", "x", "each", 1]]);
    const res = await keeper.post(`${central}/imports/inventory`).set(H).set("content-type", XLSX).send(file);
    expect(res.status).toBe(200);
    expect(report(res).dryRun).toBe(true);
    expect(await stockOf("DEFAULT-DRY")).toBeUndefined();
  });

  it("an exported file imports back as 'unchanged' (apostrophes from formula-neutralization are removed)", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const exported = (await binary(keeper.get(`${central}/reports/inventory.xlsx`))).body as Buffer;
    const r = report(await upload(keeper, exported));
    expect(r.fileErrors).toEqual([]);
    expect(r.rows.filter((x) => x.errors.length), JSON.stringify(r.rows.filter((x) => x.errors.length))).toEqual([]);
    // Only the two seeded names that begin with a tab / carriage return differ, because leading whitespace is trimmed on import.
    expect(r.rows.filter((x) => x.action !== "unchanged").map((x) => x.sku).sort()).toEqual(["INJ-4", "INJ-5"]);
  });
});

describe("import: apply", () => {
  it("applies in one transaction, writes ledger entries for stock changes, and keeps stock reconcilable", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const before = (await stockOf("BRG-6204"))!;
    const ledgerBefore = await ledgerCount();
    const file = await makeXlsx([HEAD, ["BRG-6204", "Bearing 6204 (renamed)", null, before.on_hand + 10, null, 101], ["APPLY-001", "Applied widget", "box", 30, 3, 7]]);
    const res = await upload(keeper, file, { dryRun: false });
    expect(res.status).toBe(201);
    const r = report(res);
    expect(r).toMatchObject({ applied: true, dryRun: false, replayed: false });
    expect(r.totals).toMatchObject({ create: 1, update: 1, errors: 0, stockChanges: 2 });

    expect((await stockOf("BRG-6204"))!.on_hand).toBe(before.on_hand + 10);
    expect((await stockOf("APPLY-001"))!.on_hand).toBe(30);
    expect(await ledgerCount()).toBe(ledgerBefore + 2);
    const ledger = await db_("select delta, balance_after, reason, ref_type, actor_id from stock_ledger where item_id in ($1, $2) order by created_at desc limit 2", [before.id, (await stockOf("APPLY-001"))!.id]);
    expect(ledger.map((l) => l.reason).sort()).toEqual(["adjustment", "opening-balance"]);
    expect(ledger.every((l) => l.ref_type === "import" && l.actor_id)).toBe(true);
    const row = (await db_("select name, extras from inventory_items where id = $1", [before.id]))[0]!;
    expect(row.name).toBe("Bearing 6204 (renamed)");
    expect((row.extras as Record<string, unknown>).price).toBe(101);
    expect((await db_("select 1 from audit_events where action = 'inventory.import' and site_id = $1", [SITES.centralStores])).length).toBeGreaterThan(0);

    const recon = (await keeper.get(`${central}/inventory/reconciliation`)).body.data as { balanced?: boolean; mismatches?: unknown[] } | unknown[];
    expect(JSON.stringify(recon)).not.toMatch(/"mismatch(es)?":\[\{/);
  });

  it("requires an Idempotency-Key to apply", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const res = await upload(keeper, await makeXlsx([HEAD, ["NOKEY-1", "x"]]), { dryRun: false, key: null });
    expect(res.status).toBe(400);
    expect(await stockOf("NOKEY-1")).toBeUndefined();
  });

  it("the same key and file never applies twice; the same key with a different file is refused", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const file = await makeXlsx([HEAD, ["IDEM-1", "Idem item", "each", 5]]);
    const key = newKey();
    const first = await upload(keeper, file, { dryRun: false, key });
    expect(first.status).toBe(201);
    const ledgerAfterFirst = await ledgerCount();
    const second = await upload(keeper, file, { dryRun: false, key });
    expect(second.status).toBe(200);
    expect(report(second)).toMatchObject({ applied: true, replayed: true });
    expect(await ledgerCount()).toBe(ledgerAfterFirst);
    expect((await stockOf("IDEM-1"))!.on_hand).toBe(5);

    const other = await upload(keeper, await makeXlsx([HEAD, ["IDEM-2", "Other", "each", 9]]), { dryRun: false, key });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("idempotency_key_reuse");
    expect(await stockOf("IDEM-2")).toBeUndefined();
  });

  it("a fresh key for the same already-applied file changes nothing (rows are now 'unchanged')", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const ledgerBefore = await ledgerCount();
    const r = report(await upload(keeper, await makeXlsx([HEAD, ["IDEM-1", "Idem item", "each", 5]]), { dryRun: false }));
    expect(r.totals).toMatchObject({ create: 0, update: 0, unchanged: 1 });
    expect(await ledgerCount()).toBe(ledgerBefore);
  });

  it("one bad row blocks the whole import: nothing is written and the key is not consumed", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const itemsBefore = await itemCount();
    const key = newKey();
    const bad = await makeXlsx([HEAD, ["OK-ROW", "Fine", "each", 3], ["BAD ROW!", "Bad sku", "each", 3], ["NEG-1", "Negative", "each", -4], ["FRAC-1", "Fractional", "each", 1.5], ["PRICE-1", "Price text", "each", 1, null, "cheap"]]);
    const res = await upload(keeper, bad, { dryRun: false, key });
    expect(res.status).toBe(200);
    const r = report(res);
    expect(r.applied).toBe(false);
    expect(r.totals.errors).toBe(4);
    expect(r.rows.find((x) => x.sku === "OK-ROW")!.action).toBe("create"); // valid rows are reported, but not written
    expect(r.rows.find((x) => x.row === 3)!.errors.join(" ")).toMatch(/SKU may contain/);
    expect(r.rows.find((x) => x.sku === "NEG-1")!.errors.join(" ")).toMatch(/cannot be negative/);
    expect(r.rows.find((x) => x.sku === "FRAC-1")!.errors.join(" ")).toMatch(/whole number/);
    expect(r.rows.find((x) => x.sku === "PRICE-1")!.errors.join(" ")).toMatch(/Unit price must be a number/);
    expect(await itemCount()).toBe(itemsBefore);
    expect(await stockOf("OK-ROW")).toBeUndefined();
    // The key was not consumed, so the corrected file can use it.
    const fixed = await upload(keeper, await makeXlsx([HEAD, ["OK-ROW", "Fine", "each", 3]]), { dryRun: false, key });
    expect(fixed.status).toBe(201);
    expect((await stockOf("OK-ROW"))!.on_hand).toBe(3);
  });

  it("two simultaneous imports creating the same new SKU: exactly one wins, nothing is duplicated", async () => {
    const a = await loginAs("storekeeper@opshub.local");
    const b = await loginAs("admin@opshub.local");
    const file = await makeXlsx([HEAD, ["RACE-1", "Race item", "each", 10]]);
    const results = await Promise.all([upload(a, file, { dryRun: false }), upload(b, file, { dryRun: false })]);
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 201, 409]).toContain(r.status);
    expect((await db_("select count(*)::int n from inventory_items where site_id = $1 and sku = 'RACE-1'", [SITES.centralStores]))[0]!.n).toBe(1);
    expect((await stockOf("RACE-1"))!.on_hand).toBe(10); // the second import saw the first and changed nothing, or was rolled back
    const ledger = (await db_("select count(*)::int n from stock_ledger sl join inventory_items i on i.id = sl.item_id where i.sku = 'RACE-1' and i.site_id = $1", [SITES.centralStores]))[0]!.n;
    expect(ledger).toBe(1);
  });
});

describe("import: hostile and invalid files", () => {
  it("never evaluates or stores formulas in uploaded cells", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const file = await makeXlsx([HEAD, ["FORMULA-1", { formula: "1+1", result: 2 }, "each", 1], ["FORMULA-2", "Fine name", "each", { formula: "SUM(1,2)", result: 3 }]]);
    const r = report(await upload(keeper, file));
    expect(r.totals.errors).toBe(2);
    expect(r.rows.map((x) => x.errors.join(" "))).toEqual([expect.stringMatching(/Name formulas are not allowed/), expect.stringMatching(/On hand formulas are not allowed/)]);
    expect(await stockOf("FORMULA-1")).toBeUndefined();
  });

  it("stores formula-looking TEXT as plain data (a name like '+5V regulator' is legitimate)", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const file = await makeXlsx([HEAD, ["TEXT-1", "+5V regulator", "each", 2], ["TEXT-2", "=not a formula", "each", 2]]);
    expect(report(await upload(keeper, file, { dryRun: false })).applied).toBe(true);
    const rows = await db_("select name from inventory_items where site_id = $1 and sku in ('TEXT-1','TEXT-2') order by sku", [SITES.centralStores]);
    expect(rows.map((r) => r.name)).toEqual(["+5V regulator", "=not a formula"]);
    // ...and leaves the database again as safe text.
    const out = (await binary(keeper.get(`${central}/reports/inventory.xlsx`))).body as Buffer;
    const ws = await readSheet(out);
    const names = ws.getRows(2, ws.rowCount)!.filter((r) => String(r.getCell(1).value).startsWith("TEXT-")).map((r) => r.getCell(2).value);
    expect(names).toEqual(["'+5V regulator", "'=not a formula"]);
  });

  it("rejects unknown, duplicate and missing columns as file errors", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const unknown = report(await upload(keeper, await makeXlsx([["SKU", "Name", "Password"], ["A-1", "x", "hunter2"]])));
    expect(unknown.fileErrors.join(" ")).toMatch(/“Password” is not recognised/);
    expect(unknown.rows).toEqual([]);
    const dup = report(await upload(keeper, await makeXlsx([["SKU", "Name", "name"], ["A-1", "x", "y"]])));
    expect(dup.fileErrors.join(" ")).toMatch(/appears more than once/);
    const noSku = report(await upload(keeper, await makeXlsx([["Name"], ["x"]])));
    expect(noSku.fileErrors.join(" ")).toMatch(/SKU column is required/);
    // A header that is itself a formula is a file error, not something to run.
    const evilHeader = report(await upload(keeper, await makeXlsx([["SKU", { formula: "1+1", result: 2 }], ["A-1", "x"]])));
    expect(evilHeader.fileErrors.length).toBeGreaterThan(0);
  });

  it("flags duplicate SKUs inside one file", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const r = report(await upload(keeper, await makeXlsx([HEAD, ["DUP-1", "a", "each", 1], ["DUP-1", "b", "each", 2]])));
    expect(r.rows[1]!.errors.join(" ")).toMatch(/already appears on row 2/);
  });

  it("limits rows", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const rows: unknown[][] = [HEAD];
    for (let i = 0; i < 1001; i++) rows.push([`BULK-${i}`, "x", "each", 1]);
    const r = report(await upload(keeper, await makeXlsx(rows)));
    expect(r.fileErrors.join(" ")).toMatch(/more than 1000 data rows/);
    expect(r.rows).toEqual([]);
  });

  it("rejects things that are not spreadsheets, truncated files, and oversized uploads", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    for (const bad of [Buffer.from(""), Buffer.from("SKU,Name\nA-1,x\n"), Buffer.from("<html>nope</html>"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])]) {
      const res = await upload(keeper, bad);
      expect([413, 422], `status ${res.status}`).toContain(res.status);
      expect(res.body.error).toBeDefined();
    }
    const good = await makeXlsx([HEAD, ["TRUNC-1", "x"]]);
    const truncated = await upload(keeper, good.subarray(0, Math.floor(good.length / 2)));
    expect(truncated.status).toBe(422);
    const huge = await upload(keeper, Buffer.alloc(1_100_000, 7));
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("payload_too_large");
    expect(await stockOf("TRUNC-1")).toBeUndefined();
  });

  it("rejects a zip bomb (tiny upload that expands enormously) without unpacking it", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const zip = new JSZip();
    zip.file("xl/worksheets/sheet1.xml", Buffer.alloc(30_000_000, 0x20));
    zip.file("[Content_Types].xml", "<Types/>");
    const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(bomb.length).toBeLessThan(1_000_000);
    const res = await upload(keeper, bomb);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unreasonable size/);
  });

  it("rejects a JSON body instead of a file", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const res = await keeper.post(`${central}/imports/inventory`).set(H).send({ rows: [] });
    expect(res.status).toBe(415);
  });

  it("surfaces a malformed JSON body as a client error rather than a crash", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const res = await keeper.post(`${central}/requests`).set(H).set("content-type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });
});

describe("import: access control", () => {
  const file = () => makeXlsx([HEAD, ["ACL-1", "x", "each", 1]]);
  it("needs a session, the CSRF header, membership of THIS site, and inventory:manage", async () => {
    expect((await request(app).post(`${central}/imports/inventory?dryRun=true`).set(H).set("content-type", XLSX).send(await file())).status).toBe(401);
    const keeper = await loginAs("storekeeper@opshub.local");
    expect((await keeper.post(`${central}/imports/inventory?dryRun=true`).set("content-type", XLSX).send(await file())).status).toBe(403); // no CSRF header
    expect((await upload(keeper, await file(), { site: dist })).status).toBe(404); // other site: invisible
    expect((await upload(await loginAs("dispatcher@opshub.local"), await file(), { site: dist })).status).toBe(403); // member without inventory:manage
    expect((await upload(await loginAs("dispatcher@opshub.local"), await file())).status).toBe(404);
    expect(await stockOf("ACL-1")).toBeUndefined();
  });

  it("an import into one site can never touch another site's items", async () => {
    const admin = await loginAs("admin@opshub.local");
    const other = (await db_("select count(*)::int n from inventory_items where site_id <> $1", [SITES.centralStores]))[0]!.n as number;
    const res = await upload(admin, await makeXlsx([HEAD, ["BRG-6204", "hijack", "each", 999999]]), { dryRun: false });
    expect(res.status).toBe(201);
    expect((await db_("select count(*)::int n from inventory_items where site_id <> $1", [SITES.centralStores]))[0]!.n).toBe(other);
    expect((await db_("select count(*)::int n from inventory_items where site_id <> $1 and name = 'hijack'", [SITES.centralStores]))[0]!.n).toBe(0);
  });

  it("the template download is the exact header set an import accepts", async () => {
    const keeper = await loginAs("storekeeper@opshub.local");
    const tpl = (await binary(keeper.get(`${central}/imports/inventory/template.xlsx`))).body as Buffer;
    const ws = await readSheet(tpl);
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(HEAD);
    const r = report(await upload(keeper, tpl));
    expect(r.fileErrors).toEqual([]);
    expect((await keeper.get(`${central}/imports/inventory/template.xlsx`)).status).toBe(200);
    expect((await (await loginAs("dispatcher@opshub.local")).get(`${dist}/imports/inventory/template.xlsx`)).status).toBe(403);
  });
});
