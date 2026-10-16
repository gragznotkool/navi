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

/** Verifies signature, algorithm, issuer, audience and expiry. Returns null for any failure. */
export function verifyToken(secret: string, token: string): TokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    const parsed = claimsSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
