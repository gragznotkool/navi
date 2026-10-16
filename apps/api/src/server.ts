import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
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
