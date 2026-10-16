import ExcelJS from "exceljs";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MASKED_CELL } from "@opshub/contracts";
import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { DEV_PASSWORD } from "../../src/db/seeds/seed.js";
import type { Database } from "../../src/db/scoped.js";
import { adminPool, appDb, freshDatabase, SITES, USERS } from "../support/db.js";

const H = { "x-opshub-client": "web" };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const base = `/api/v1/sites/${SITES.centralStores}/reports/inventory`;
let app: Express;
let db: Database;

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").set(H).send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

async function exportRows(agent: request.Agent) {
  const res = await agent.get(`${base}/export`).buffer(true).parse(binary);
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1) as string[];
  const rows = Array.from({ length: ws.rowCount - 1 }, (_, i) => Object.fromEntries(header.map((h, c) => [h, ws.getRow(i + 2).getCell(c + 1).value])));
  return { res, header, rows };
}

async function workbook(header: string[], rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Inventory");
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const upload = (agent: request.Agent, buf: Buffer | string, query = "") =>
  agent.post(`${base}/import${query}`).set(H).set("content-type", XLSX).set("x-file-name", "stock.xlsx").send(buf);

const HEAD = ["SKU", "Item Name", "Quantity"];
const count = async (sql: string, params: unknown[] = []) => {
  const pool = adminPool();
  try {
    return (await pool.query(sql, params)).rows[0].n as number;
  } finally {
    await pool.end();
  }
};

beforeAll(async () => {
  await freshDatabase();
  db = appDb();
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_APP_URL!,
    DATABASE_ADMIN_URL: process.env.TEST_ADMIN_URL!,
    PG_DUMP_PATH: "definitely-not-a-real-pg-dump",
    JWT_SECRET: "x".repeat(40),
    WEB_ORIGIN: "http://localhost:5173",
  } as NodeJS.ProcessEnv);
  app = createApp({ db, env, loginRateLimit: 1000 });
});
afterAll(async () => db.close());

describe("export: same button, different trust level", () => {
  it("shows an administrator every column", async () => {
    const { res, rows } = await exportRows(await loginAs("admin@opshub.local"));
    expect(res.headers["content-type"]).toContain(XLSX);
    expect(rows.length).toBe(3);
    const bearing = rows.find((r) => r["SKU"] === "BRG-6204")!;
    expect(bearing["Unit Cost ($)"]).toBe(8.5);
    expect(bearing["Margin (%)"]).toBe(28);
    expect(bearing["Total Value ($)"]).toBe(1020);
  });

  it("masks cost, margin and value for a storekeeper but keeps quantities", async () => {
    const { rows } = await exportRows(await loginAs("storekeeper@opshub.local"));
    for (const r of rows) {
      expect(r["Unit Cost ($)"]).toBe(MASKED_CELL);
      expect(r["Margin (%)"]).toBe(MASKED_CELL);
      expect(r["Total Value ($)"]).toBe(MASKED_CELL);
      expect(typeof r["Quantity"]).toBe("number");
      expect(typeof r["SKU"]).toBe("string");
    }
  });

  it("lists what each role may do, including masked columns", async () => {
    const res = await (await loginAs("storekeeper@opshub.local")).get(`/api/v1/sites/${SITES.centralStores}/reports`);
    const inv = res.body.data[0];
    expect(inv).toMatchObject({ key: "inventory", canExport: true, canImport: true });
    expect(inv.columns.filter((c: { masked: boolean }) => c.masked).map((c: { key: string }) => c.key).sort()).toEqual(["totalValue", "unitCost", "vendorMargin"]);
  });

  it("returns 404 to non-members and 403 to members whose role is not allowed", async () => {
    expect((await (await loginAs("technician@opshub.local")).get(`${base}/export`)).status).toBe(404);
    const pool = adminPool();
    await pool.query("insert into user_site_roles (user_id, site_id, role_id) select $1, $2, id from roles where key = 'technician'", [USERS.technician, SITES.centralStores]);
    await pool.end();
    const tech = await loginAs("technician@opshub.local");
    expect((await tech.get(`${base}/export`)).status).toBe(403);
    expect((await upload(tech, Buffer.from("x"))).status).toBe(403);
  });

  it("requires authentication and an existing report key", async () => {
    expect((await request(app).get(`${base}/export`)).status).toBe(401);
    expect((await (await loginAs("admin@opshub.local")).get(`/api/v1/sites/${SITES.centralStores}/reports/nope/export`)).status).toBe(404);
  });
});

describe("import: zero tolerance", () => {
  it("rejects the whole file when one cell is negative and writes nothing", async () => {
    const admin = await loginAs("admin@opshub.local");
    const before = await count("select count(*)::int n from inventory_items");
    const rows: (string | number)[][] = Array.from({ length: 20 }, (_, i) => [`IMP-${i}`, `Imported ${i}`, 10]);
    rows[12] = ["IMP-12", "Imported 12", -5]; // spreadsheet row 14
    const res = await upload(admin, await workbook(HEAD, rows));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("import_rejected");
    expect(res.body.error.message).toBe("Row 14: Quantity must be greater than or equal to 0. 0 rows written to database.");
    expect(res.body.error.details[0]).toMatchObject({ row: 14, column: "Quantity" });
    expect(await count("select count(*)::int n from inventory_items")).toBe(before);
    expect(await count("select count(*)::int n from audit_events where action = 'report.import_rejected'")).toBe(1);
  });

  it("collects every bad row and cell, not just the first", async () => {
    const admin = await loginAs("admin@opshub.local");
    const res = await upload(admin, await workbook(["SKU", "Item Name", "Quantity", "Unit Cost ($)", "Margin (%)"], [
      ["A-1", "ok", 1, 1, 1],
      ["", "missing sku", 1, 1, 1],
      ["A-3", "bad type", "ten", 1, 1],
      ["A-4", "fraction", 1.5, 1, 1],
      ["A-5", "margin", 1, 1, 150],
      ["A-1", "duplicate", 1, 1, 1],
    ]));
    expect(res.status).toBe(422);
    const got = res.body.error.details.map((d: { row: number; column: string }) => `${d.row}:${d.column}`);
    expect(got).toEqual(["3:SKU", "4:Quantity", "5:Quantity", "6:Margin (%)", "7:SKU"]);
  });

  it("rejects unknown/missing columns, formulas, non-xlsx files and oversized uploads", async () => {
    const admin = await loginAs("admin@opshub.local");
    const unknown = await upload(admin, await workbook(["SKU", "Item Name", "Quantity", "Secret"], [["Z-1", "x", 1, 1]]));
    expect(unknown.body.error.details.map((d: { column: string }) => d.column)).toContain("Secret");
    const missing = await upload(admin, await workbook(["SKU", "Quantity"], [["Z-1", 1]]));
    expect(missing.body.error.details[0].message).toMatch(/Item Name.*missing/);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(HEAD);
    ws.addRow(["F-1", "formula", { formula: "1+1", result: 2 }]);
    const formula = await upload(admin, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(formula.status).toBe(422);
    expect(formula.body.error.details[0].message).toMatch(/formula/);

    expect((await upload(admin, "not a spreadsheet")).status).toBe(422);
    expect((await upload(admin, Buffer.alloc(5 * 1024 * 1024 + 1024, 1))).status).toBe(413);
  });

  it("enforces the 5,000 row limit", async () => {
    const admin = await loginAs("admin@opshub.local");
    const rows = Array.from({ length: 5001 }, (_, i) => [`BULK-${i}`, "bulk", 1]);
    const res = await upload(admin, await workbook(HEAD, rows));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("too_many_rows");
  });

  it("previews with dryRun, then writes everything atomically with ledger + audit", async () => {
    const admin = await loginAs("admin@opshub.local");
    const file = await workbook(["SKU", "Item Name", "Quantity", "Unit Cost ($)", "Margin (%)"], [
      ["OK-1", "Good one", 5, 2.5, 10],
      ["OK-2", "=HYPERLINK(\"http://evil\",\"x\")", 0, 1, 5],
      ["OK-3", "Third", 7, 0, 0],
    ]);
    const before = await count("select count(*)::int n from inventory_items");
    const dry = await upload(admin, file, "?dryRun=true");
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ dryRun: true, rowCount: 3, written: 0 });
    expect(await count("select count(*)::int n from inventory_items")).toBe(before);

    const real = await upload(admin, file);
    expect(real.status).toBe(201);
    expect(real.body.data).toMatchObject({ written: 3, fileName: "stock.xlsx" });
    expect(await count("select count(*)::int n from inventory_items")).toBe(before + 3);
    // zero-quantity item has no opening ledger row; the others do and still reconcile
    expect(await count("select count(*)::int n from stock_ledger where ref_type = 'import'")).toBe(2);
    expect(await count("select count(*)::int n from stock_reconciliation where not reconciled")).toBe(0);
    expect(await count("select count(*)::int n from audit_events where action = 'report.imported' and metadata->>'fileName' = 'stock.xlsx' and (metadata->>'rowCount')::int = 3 and actor_id = $1", [USERS.admin])).toBe(1);

    // re-importing the same SKUs is refused
    const again = await upload(admin, file);
    expect(again.status).toBe(422);
    expect(again.body.error.details[0].message).toMatch(/already exists/);

    // and the formula-looking name is neutralised when exported
    const { rows } = await exportRows(admin);
    expect(rows.find((r) => r["SKU"] === "OK-2")!["Item Name"]).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
  });

  it("does not let a masked role write confidential columns", async () => {
    const sk = await loginAs("storekeeper@opshub.local");
    const res = await upload(sk, await workbook(["SKU", "Item Name", "Quantity", "Unit Cost ($)"], [["SK-1", "x", 1, 99]]));
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toMatchObject({ row: 2, column: "Unit Cost ($)" });
    const ok = await upload(sk, await workbook(HEAD, [["SK-2", "allowed", 3]]));
    expect(ok.status).toBe(201);
  });
});

describe("admin backup download", () => {
  it("is limited to platform admins", async () => {
    expect((await request(app).get("/api/v1/hub/backup")).status).toBe(401);
    expect((await (await loginAs("storekeeper@opshub.local")).get("/api/v1/hub/backup")).status).toBe(403);
  });

  it("reports a clean 503 (not a corrupt download) when pg_dump is unavailable", async () => {
    const res = await (await loginAs("admin@opshub.local")).get("/api/v1/hub/backup");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("backup_unavailable");
  });
});
