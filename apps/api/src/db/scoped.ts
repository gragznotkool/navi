import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import * as schema from "./schema/index.js";

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

export interface TenantContext {
  siteId: string;
  userId: string;
}

const uuidSchema = z.string().uuid();

/**
 * The ONLY way application code touches the database.
 *
 * Every callback runs inside a single transaction. Tenant identity is set with
 * `set_config(..., is_local = true)`, so it vanishes at COMMIT/ROLLBACK and can never
 * leak to the next user of a pooled connection. PostgreSQL RLS policies read these settings.
 */
export class Database {
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(readonly pool: pg.Pool) {
    this.db = drizzle(pool, { schema });
  }

  /** Site-scoped work. Both ids are validated as UUIDs before use. */
  async withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const siteId = uuidSchema.parse(ctx.siteId);
    const userId = uuidSchema.parse(ctx.userId);
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.current_site_id', ${siteId}, true), set_config('app.current_user_id', ${userId}, true)`,
      );
      return fn(tx);
    });
  }

  /** User-scoped work (e.g. listing the sites a user belongs to). No site context. */
  async withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const id = uuidSchema.parse(userId);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_user_id', ${id}, true)`);
      return fn(tx);
    });
  }

  /**
   * No tenant context at all. Tenant tables return zero rows under RLS; only global
   * identity tables (users, roles) are reachable. Used for login and health checks.
   */
  withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export function createDatabase(connectionString: string, max = 10): Database {
  return new Database(new pg.Pool({ connectionString, max }));
}
