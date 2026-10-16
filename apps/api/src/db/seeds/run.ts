import { loadEnv } from "../../config/env.js";
import { seed } from "./seed.js";

const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
if (!env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for seeding");
await seed(env.DATABASE_ADMIN_URL);
console.log("Seed complete (development demo data).");
