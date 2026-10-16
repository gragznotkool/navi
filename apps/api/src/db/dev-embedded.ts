import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { loadEnv } from "../config/env.js";
import { runMigrations } from "./migrate.js";
import { seed } from "./seeds/seed.js";

/**
 * Development fallback for machines without Docker: runs a real PostgreSQL 16 using the
 * credentials from .env, then migrates and seeds it. Data persists in apps/api/.pgdata.
 * The documented/CI path is docker-compose.yml.
 */
const env = loadEnv();
if (env.NODE_ENV === "production" || !env.DATABASE_ADMIN_URL) throw new Error("dev-embedded requires a development .env with DATABASE_ADMIN_URL");
const admin = new URL(env.DATABASE_ADMIN_URL);
const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../.pgdata");
const fresh = !existsSync(dir);

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: decodeURIComponent(admin.username),
  password: decodeURIComponent(admin.password),
  port: Number(admin.port || 5432),
  persistent: true,
  onLog: () => undefined,
});
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase(admin.pathname.slice(1));
await runMigrations(env.DATABASE_ADMIN_URL, env.DATABASE_URL);
await seed(env.DATABASE_ADMIN_URL, { demoData: true });
console.log(`Embedded PostgreSQL ready on port ${admin.port || 5432} (migrated + seeded). Press Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => undefined, 1 << 30);
