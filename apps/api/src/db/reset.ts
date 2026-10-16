import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import { runMigrations } from "./migrate.js";

/** Destroys ALL data in the target database and re-applies migrations. Development only. */
export async function resetDatabase(adminUrl: string, appUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await pool.query("drop schema if exists public cascade");
    await pool.query("drop schema if exists drizzle cascade");
    await pool.query("create schema public");
  } finally {
    await pool.end();
  }
  await runMigrations(adminUrl, appUrl);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = loadEnv();
  if (env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
  if (!env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required");
  await resetDatabase(env.DATABASE_ADMIN_URL, env.DATABASE_URL);
  console.log("Database reset and migrated.");
}
