import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// Load the repo-root .env for local development if present. Real environment variables win.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** An unset or empty variable means "not configured" (docker compose passes empty strings for unset values). */
const optionalSecret = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(10).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Access token lifetime. Short on purpose: the refresh token keeps the user signed in. */
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).default(600),
  /** Pause between provisioning steps so the live log can be watched (0 = as fast as possible). */
  PROVISIONING_STEP_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(0),
  /** "Bolo & Build" AI provider. `auto` prefers Gemini when its key is set, then Anthropic, else the built-in fallback. Keys stay on the server. */
  AI_PROVIDER: z.enum(["auto", "gemini", "anthropic", "none"]).default("auto"),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(8000),
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
