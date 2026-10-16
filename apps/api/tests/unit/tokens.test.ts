import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { signToken, verifyToken } from "../../src/security/tokens.js";

const OLD = "o".repeat(40);
const NEW = "n".repeat(40);
const claims = { sub: "10000000-0000-4000-8000-000000000001", tv: 0 } as never;

describe("signing key rotation", () => {
  it("accepts tokens signed with a listed older key, signs new ones with the current key, and refuses unlisted keys", () => {
    const old = signToken(OLD, claims, 60).token;
    const fresh = signToken(NEW, claims, 60).token;
    expect(verifyToken([NEW, OLD], old)).not.toBeNull();
    expect(verifyToken([NEW, OLD], fresh)).not.toBeNull();
    expect(verifyToken([NEW], old)).toBeNull(); // old key removed: those sessions end
    expect(verifyToken(OLD, fresh)).toBeNull(); // new tokens are NOT verifiable with the old key alone
    expect(verifyToken(NEW, "not.a.token")).toBeNull();
    expect(verifyToken([], old)).toBeNull();
  });

  it("reads previous keys from the environment and insists they are long enough", () => {
    const base = { NODE_ENV: "test", DATABASE_URL: "postgres://u:p@localhost:5432/db", JWT_SECRET: NEW } as NodeJS.ProcessEnv;
    expect(loadEnv(base).JWT_SECRET_PREVIOUS).toEqual([]);
    expect(loadEnv({ ...base, JWT_SECRET_PREVIOUS: ` ${OLD} , ${"p".repeat(32)} ` }).JWT_SECRET_PREVIOUS).toEqual([OLD, "p".repeat(32)]);
    expect(() => loadEnv({ ...base, JWT_SECRET_PREVIOUS: "short" })).toThrow(/at least 32/);
  });

  it("treats empty AI keys as 'not configured'", () => {
    const base = { NODE_ENV: "test", DATABASE_URL: "postgres://u:p@localhost:5432/db", JWT_SECRET: NEW } as NodeJS.ProcessEnv;
    expect(loadEnv({ ...base, GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "" }).GEMINI_API_KEY).toBeUndefined();
    expect(loadEnv({ ...base, TRUST_PROXY: "1" }).TRUST_PROXY).toBe(1);
  });
});
