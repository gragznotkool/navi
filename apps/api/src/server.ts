import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { sql } from "drizzle-orm";
import { createDatabase } from "./db/scoped.js";

const env = loadEnv();
const db = createDatabase(env.DATABASE_URL);
const app = createApp({
  db,
  env,
  log: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
});
app.listen(env.API_PORT, () => {
  console.log(JSON.stringify({ level: "info", msg: "opshub-api listening", port: env.API_PORT }));
});

// Hindi and Marathi text can only be stored in a UTF8 database. Say so loudly instead of failing later on a save.
db.withoutTenant(async (tx) => (await tx.execute<{ enc: string }>(sql`show server_encoding`)).rows[0]?.enc)
  .then((enc) => {
    if (enc && enc.toUpperCase() !== "UTF8") console.warn(JSON.stringify({ level: "warn", msg: `Database encoding is ${enc}, not UTF8: Hindi/Marathi text will be rejected on save. Recreate the database with ENCODING 'UTF8' (see userconfig.md).` }));
  })
  .catch(() => undefined);
