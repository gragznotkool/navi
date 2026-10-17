import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import { dropSchema } from "./reset.js";
import { runMigrations } from "./migrate.js";
import { seed } from "./seeds/seed.js";

/** One command: drop -> migrate -> compile configs + seed 120 requests -> verify ledger. Development only. */
const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
if (!env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required");

const started = performance.now();
const step = (n: number, msg: string) => console.log(`[${n}/4] ${msg}`);

async function isConnected(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const pgDir = resolve(here, "../../.pgdata");
let spawnedPg: EmbeddedPostgres | null = null;

if (!(await isConnected(env.DATABASE_ADMIN_URL))) {
  console.log("No PostgreSQL server detected on port 5432. Starting Embedded PostgreSQL temporarily...");
  const admin = new URL(env.DATABASE_ADMIN_URL);
  const fresh = !existsSync(pgDir);
  spawnedPg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: decodeURIComponent(admin.username),
    password: decodeURIComponent(admin.password),
    port: Number(admin.port || 5432),
    persistent: true,
    onLog: () => undefined,
  });
  if (fresh) await spawnedPg.initialise();
  await spawnedPg.start();
  if (fresh) await spawnedPg.createDatabase(admin.pathname.slice(1));
}

try {
  step(1, "Dropping schema...");
  await dropSchema(env.DATABASE_ADMIN_URL);
  step(2, "Applying migrations...");
  await runMigrations(env.DATABASE_ADMIN_URL, env.DATABASE_URL);
  step(3, "Compiling site configs and seeding demo data...");
  const result = await seed(env.DATABASE_ADMIN_URL, { demoData: true });
  console.log(`      seeded ${result.demo?.requests ?? 0} requests, ${result.demo?.skus ?? 0} demo SKUs, ${result.demo?.ledgerRows ?? 0} ledger rows, ${result.demo?.auditEvents ?? 0} audit events`);
  step(4, `Validating ledger balance: SUM(delta) == onHand for ${result.skusVerified} SKUs [OK]`);
  console.log(`Pristine environment restored in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
} finally {
  if (spawnedPg) {
    await spawnedPg.stop();
  }
}
