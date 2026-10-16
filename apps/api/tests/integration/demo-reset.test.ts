import { afterAll, describe, expect, it } from "vitest";
import { adminPool, freshDatabase, SITES } from "../support/db.js";

// `npm run demo:reset` is exactly drop schema -> migrate -> seed; this runs the same functions against the test database.
describe("demo reset", () => {
  it("returns to the known seeded state, twice in a row, well inside 30 seconds", async () => {
    for (let i = 0; i < 2; i++) {
      const started = Date.now();
      await freshDatabase();
      expect(Date.now() - started).toBeLessThan(30_000);
      const pool = adminPool();
      try {
        const q = async (text: string) => (await pool.query(text)).rows[0] as Record<string, number>;
        expect((await q("select count(*)::int n from sites where not is_system")).n).toBe(3);
        expect((await q("select count(*)::int n from users where email like '%@opshub.local'")).n).toBe(5);
        expect((await q(`select count(*)::int n from site_active_releases where version = 1`)).n).toBeGreaterThanOrEqual(3);
        expect((await q("select count(*)::int n from requests")).n).toBe(0);
        expect((await q(`select count(*)::int n from stock_reconciliation where not reconciled`)).n).toBe(0);
        expect((await q(`select count(*)::int n from sites where id = '${SITES.distribution}'`)).n).toBe(1);
      } finally {
        await pool.end();
      }
    }
  });
});
afterAll(() => undefined);
