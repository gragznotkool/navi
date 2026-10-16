import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load the repo-root .env for local development if present. Real environment variables win.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../.env"),
  resolve(__dirname, "../../../../.env"),
  resolve(__dirname, "../../.env"),
];

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
      break;
    } catch {
      // Continue searching candidates
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  /** Path to the pg_dump binary used by the admin backup download. Defaults to `pg_dump` on PATH. */
  PG_DUMP_PATH: z.string().default("pg_dump"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Access token lifetime. Short on purpose: the refresh token keeps the user signed in. */
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).default(600),
  /** Pause between provisioning steps so the live log can be watched (0 = as fast as possible). */
  PROVISIONING_STEP_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(0),
  /** Refresh token lifetime (sliding: each rotation issues a fresh window). */
  REFRESH_EXPIRES_IN_SECONDS: z.coerce.number().int().min(300).default(7 * 24 * 3600),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  return parsed.data;
}
