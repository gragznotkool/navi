import bcrypt from "bcrypt";
import { eq, sql } from "drizzle-orm";
import type { AuthSession, LoginRequest } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { listMemberships } from "../security/access.js";
import { issueRefreshToken, revokeAllRefreshTokens, rotateRefreshToken } from "../security/refresh.js";
import { signToken } from "../security/tokens.js";
import { unauthorized } from "../utils/errors.js";

// Compared against when the email is unknown so response time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync("opshub-timing-equaliser", 10);

export interface AuthDeps {
  db: Database;
  jwtSecret: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
}

export interface IssuedSession {
  session: AuthSession;
  token: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function login(deps: AuthDeps, input: LoginRequest, requestId: string): Promise<IssuedSession> {
  const email = input.email.trim().toLowerCase();
  const user = await deps.db.withoutTenant(async (tx) => (await tx.select().from(s.users).where(eq(s.users.email, email)).limit(1))[0]);
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await deps.db.withoutTenant((tx) =>
      recordAudit(tx, { siteId: null, actorId: user?.id ?? null, action: "auth.login-failed", entityType: "user", entityId: user?.id ?? null, requestId }),
    );
    throw unauthorized("Invalid email or password");
  }
  const { token, expiresAt } = signToken(deps.jwtSecret, { sub: user.id, tv: user.tokenVersion }, deps.expiresInSeconds);
  await deps.db.withoutTenant((tx) =>
    recordAudit(tx, { siteId: null, actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, requestId }),
  );
  const refresh = await deps.db.withoutTenant((tx) => issueRefreshToken(tx, user.id, deps.refreshExpiresInSeconds));
  const memberships = await listMemberships(deps.db, user);
  return {
    token,
    refreshToken: refresh.raw,
    refreshExpiresAt: refresh.expiresAt,
    session: {
      user: { id: user.id, email: user.email, displayName: user.displayName, isPlatformAdmin: user.isPlatformAdmin },
      memberships,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Exchanges a refresh token for a new access token and a rotated refresh token.
 * Any failure is the same 401 so callers learn nothing about why (expired, unknown, reused).
 */
export async function refresh(deps: AuthDeps, rawRefresh: string, requestId: string): Promise<IssuedSession> {
  const rotated = await rotateRefreshToken(deps.db, rawRefresh, deps.refreshExpiresInSeconds, requestId);
  if (rotated.kind !== "ok") throw unauthorized("Session expired. Sign in again.");
  const user = await deps.db.withoutTenant(async (tx) => (await tx.select().from(s.users).where(eq(s.users.id, rotated.userId)).limit(1))[0]);
  if (!user) throw unauthorized("Session expired. Sign in again.");
  const { token, expiresAt } = signToken(deps.jwtSecret, { sub: user.id, tv: user.tokenVersion }, deps.expiresInSeconds);
  return {
    token,
    refreshToken: rotated.raw,
    refreshExpiresAt: rotated.expiresAt,
    session: {
      user: { id: user.id, email: user.email, displayName: user.displayName, isPlatformAdmin: user.isPlatformAdmin },
      memberships: await listMemberships(deps.db, user),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/** Logout revokes every access token (token_version bump) and every refresh token of this user. */
export async function logout(db: Database, userId: string, requestId: string): Promise<void> {
  await db.withoutTenant(async (tx) => {
    await tx.update(s.users).set({ tokenVersion: sql`${s.users.tokenVersion} + 1`, updatedAt: new Date() }).where(eq(s.users.id, userId));
    await revokeAllRefreshTokens(tx, userId);
    await recordAudit(tx, { siteId: null, actorId: userId, action: "auth.logout", entityType: "user", entityId: userId, requestId });
  });
}

export async function currentSession(db: Database, user: { id: string; email: string; displayName: string; isPlatformAdmin: boolean }, expiresAt: string): Promise<AuthSession> {
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, isPlatformAdmin: user.isPlatformAdmin },
    memberships: await listMemberships(db, user),
    expiresAt,
  };
}
