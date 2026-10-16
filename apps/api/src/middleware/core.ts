import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { AppError, badRequest, forbidden, notFound, toApiError, unauthorized } from "../utils/errors.js";
import type { Database } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { resolveSiteAccess, type SiteAccess } from "../security/access.js";
import { verifyToken } from "../security/tokens.js";
import { z } from "zod";

export const SESSION_COOKIE = "opshub_session";
export const REFRESH_COOKIE = "opshub_refresh";
/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
  tokenVersion: number;
}

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    user?: AuthedUser;
    sessionExpiresAt?: string;
    siteAccess?: SiteAccess;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
};

export const errorHandler =
  (log: (msg: string, meta: Record<string, unknown>) => void): ErrorRequestHandler =>
  (err, req, res, _next) => {
    const { status, body } = toApiError(err, req.requestId);
    if (status >= 500) log("unhandled error", { requestId: req.requestId, name: err instanceof Error ? err.name : "unknown", message: err instanceof Error ? err.message : String(err) });
    res.status(status).json({ error: body });
  };

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound("Route not found"));

/** Parses and validates with Zod. Unknown keys are stripped, which blocks mass assignment. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(badRequest("Invalid request body", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))));
    }
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return next(badRequest("Invalid query parameters", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))));
    }
    // Express 5 makes req.query read-only, so validated values live on res.locals.
    res.locals.query = parsed.data;
    next();
  };
}

export function validatedQuery<T>(res: Response): T {
  return res.locals.query as T;
}

/**
 * CSRF defence for cookie auth: browsers cannot send a custom header cross-site without a CORS
 * preflight, which the API only grants to the configured web origin. Mutations must carry it.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.header("x-opshub-client") !== "web") return next(forbidden("Missing client header"));
  next();
};

export function authenticate(db: Database, jwtSecret: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
      if (!token) throw unauthorized();
      const claims = verifyToken(jwtSecret, token);
      if (!claims) throw unauthorized("Invalid or expired session");
      const user = await db.withoutTenant(async (tx) => {
        const rows = await tx.select().from(s.users).where(eq(s.users.id, claims.sub)).limit(1);
        return rows[0];
      });
      if (!user || user.tokenVersion !== claims.tv) throw unauthorized("Session has been revoked");
      req.sessionExpiresAt = new Date(claims.exp * 1000).toISOString();
      req.user = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
        tokenVersion: user.tokenVersion,
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

const siteIdParam = z.string().uuid();

/**
 * Verifies the authenticated user is a member of `:siteId` and (optionally) holds a permission.
 * The site id from the URL is never trusted on its own.
 */
export function requireSite(db: Database, permission?: string | string[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw unauthorized();
      const parsed = siteIdParam.safeParse(req.params.siteId);
      if (!parsed.success) throw notFound("Site not found");
      const access = await resolveSiteAccess(db, req.user, parsed.data);
      // Non-members get 404, not 403, so site existence is not disclosed.
      if (!access) throw notFound("Site not found");
      const anyOf = permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];
      if (anyOf.length > 0 && !anyOf.some((p) => access.permissions.has(p))) throw forbidden();
      req.siteAccess = access;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export { AppError };
