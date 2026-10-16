import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "migrations");

/**
 * Ensures the least-privilege application role exists (LOGIN, NOSUPERUSER, NOBYPASSRLS),
 * then applies all migrations. Must run with the admin connection. Safe to re-run.
 */
export async function runMigrations(adminUrl: string, appUrl: string): Promise<void> {
  const app = new URL(appUrl);
  const roleName = decodeURIComponent(app.username);
  const password = decodeURIComponent(app.password);
  if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) throw new Error("Application role name must be a simple lowercase identifier");
  if (!password) throw new Error("DATABASE_URL must include a password for the application role");

  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const literal = `'${password.replace(/'/g, "''")}'`;
    const exists = await pool.query("select 1 from pg_roles where rolname = $1", [roleName]);
    const attrs = "LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE";
    await pool.query(`${exists.rowCount ? "ALTER" : "CREATE"} ROLE ${roleName} ${attrs} PASSWORD ${literal}`);
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { loadEnv } = await import("../config/env.js");
  const env = loadEnv();
  if (!env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for migrations");
  await runMigrations(env.DATABASE_ADMIN_URL, env.DATABASE_URL);
  console.log("Migrations applied.");
}
