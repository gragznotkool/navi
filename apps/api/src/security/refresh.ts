import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../audit/audit.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";

/** Only the SHA-256 of a refresh token is stored, so a database read cannot be replayed as a session. */
export const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");
const newRawToken = (): string => randomBytes(32).toString("base64url");

export interface IssuedRefresh {
  raw: string;
  expiresAt: Date;
}

/** Starts a new token family (a login) or extends an existing one (a rotation). */
export async function issueRefreshToken(tx: Tx, userId: string, ttlSeconds: number, familyId: string = randomUUID()): Promise<IssuedRefresh & { id: string }> {
  const raw = newRawToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const [row] = await tx.insert(s.refreshTokens).values({ userId, familyId, tokenHash: hashToken(raw), expiresAt }).returning({ id: s.refreshTokens.id });
  return { raw, expiresAt, id: row!.id };
}

export type RotateResult =
  | ({ kind: "ok"; userId: string } & IssuedRefresh)
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "reuse"; userId: string };

/**
 * Exchanges a refresh token for a new one. Each token works exactly once: presenting one that was
 * already rotated (or revoked by logout) is treated as theft, and the WHOLE family is revoked so
 * neither the attacker nor the victim can keep refreshing. The revocation commits (no throw here).
 */
export async function rotateRefreshToken(db: Database, raw: string, ttlSeconds: number, requestId: string): Promise<RotateResult> {
  return db.withoutTenant(async (tx): Promise<RotateResult> => {
    const [row] = await tx.select().from(s.refreshTokens).where(eq(s.refreshTokens.tokenHash, hashToken(raw))).for("update");
    if (!row) return { kind: "invalid" };
    if (row.revokedAt) {
      await tx.update(s.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(s.refreshTokens.familyId, row.familyId), isNull(s.refreshTokens.revokedAt)));
      await recordAudit(tx, { siteId: null, actorId: row.userId, action: "auth.refresh-reuse-detected", entityType: "user", entityId: row.userId, metadata: { familyId: row.familyId }, requestId });
      return { kind: "reuse", userId: row.userId };
    }
    if (row.expiresAt.getTime() <= Date.now()) return { kind: "expired" };
    const next = await issueRefreshToken(tx, row.userId, ttlSeconds, row.familyId);
    await tx.update(s.refreshTokens).set({ revokedAt: new Date(), replacedBy: next.id }).where(eq(s.refreshTokens.id, row.id));
    return { kind: "ok", userId: row.userId, raw: next.raw, expiresAt: next.expiresAt };
  });
}

/** Logout: every refresh token of the user stops working. */
export async function revokeAllRefreshTokens(tx: Tx, userId: string): Promise<void> {
  await tx.update(s.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(s.refreshTokens.userId, userId), isNull(s.refreshTokens.revokedAt)));
}
