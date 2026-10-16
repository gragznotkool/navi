import jwt from "jsonwebtoken";
import { z } from "zod";

const ISSUER = "opshub-api";
const AUDIENCE = "opshub-web";

const claimsSchema = z.object({
  sub: z.string().uuid(),
  /** Matches users.token_version; bumping the column revokes every previously issued token. */
  tv: z.number().int(),
  exp: z.number().int(),
});
export type TokenClaims = z.infer<typeof claimsSchema>;

export function signToken(secret: string, claims: Omit<TokenClaims, "exp">, expiresInSeconds: number): { token: string; expiresAt: Date } {
  const token = jwt.sign({ tv: claims.tv }, secret, {
    algorithm: "HS256",
    subject: claims.sub,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: expiresInSeconds,
  });
  return { token, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
}

/**
 * Verifies signature, algorithm, issuer, audience and expiry. Returns null for any failure.
 * `secrets` may list the current key first and older keys after it, so a key can be rotated without signing everyone
 * out: new tokens are always signed with the first key, and tokens signed with a listed older key stay valid until they expire.
 */
export function verifyToken(secrets: string | readonly string[], token: string): TokenClaims | null {
  for (const secret of typeof secrets === "string" ? [secrets] : secrets) {
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
      const parsed = claimsSchema.safeParse(decoded);
      if (parsed.success) return parsed.data;
    } catch {
      // try the next key
    }
  }
  return null;
}
