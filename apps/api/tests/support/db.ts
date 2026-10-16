import pg from "pg";
import { resetDatabase } from "../../src/db/reset.js";
import { createDatabase, type Database } from "../../src/db/scoped.js";
import { seed } from "../../src/db/seeds/seed.js";

export const adminUrl = (): string => {
  const v = process.env.TEST_ADMIN_URL;
  if (!v) throw new Error("TEST_ADMIN_URL not set; integration tests must run via the integration vitest config");
  return v;
};
export const appUrl = (): string => {
  const v = process.env.TEST_APP_URL;
  if (!v) throw new Error("TEST_APP_URL not set");
  return v;
};

/** Fresh schema + migrations + seed. Call in beforeAll of each integration file. */
export async function freshDatabase(): Promise<void> {
  await resetDatabase(adminUrl(), appUrl());
  await seed(adminUrl());
}

export const SITES = {
  centralStores: "00000000-0000-4000-8000-000000000001",
  serviceCentre: "00000000-0000-4000-8000-000000000002",
  distribution: "00000000-0000-4000-8000-000000000003",
} as const;

export const USERS = {
  admin: "10000000-0000-4000-8000-000000000001",
  storekeeper: "10000000-0000-4000-8000-000000000002",
  technician: "10000000-0000-4000-8000-000000000003",
  approver: "10000000-0000-4000-8000-000000000004",
  dispatcher: "10000000-0000-4000-8000-000000000005",
} as const;

export const appDb = (max = 10): Database => createDatabase(appUrl(), max);
export const adminPool = (): pg.Pool => new pg.Pool({ connectionString: adminUrl(), max: 2 });

/** Asserts a promise rejects and that the full error chain (including driver `cause`) matches. */
export async function rejectsWith(promise: Promise<unknown>, pattern?: RegExp | string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const parts: string[] = [];
    let cur: unknown = e;
    while (cur instanceof Error) {
      parts.push(cur.message);
      cur = cur.cause;
    }
    const text = parts.join(" | ");
    if (pattern === undefined) return;
    const ok = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
    if (!ok) throw new Error(`Rejected, but error did not match ${String(pattern)}: ${text}`);
    return;
  }
  throw new Error("Expected promise to reject, but it resolved");
}
