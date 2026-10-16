import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type Express, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { eq } from "drizzle-orm";
import {
  configurationPayloadSchema,
  createAssignmentPayloadSchema,
  createRequestPayloadSchema,
  decideRequestPayloadSchema,
  loginRequestSchema,
  paginationRequestSchema,
  publishRequestSchema,
  recordConsumptionPayloadSchema,
  rollbackRequestSchema,
  configurationDraftSchema,
  REPORT_MAX_BYTES,
  type PaginationRequest,
  type SiteSummary,
} from "@opshub/contracts";
import { backupFileName, streamBackup } from "./backup/pgdump.js";
import { recordAudit } from "./audit/audit.js";
import { compileConfiguration } from "./compiler/compile.js";
import type { Env } from "./config/env.js";
import type { Database } from "./db/scoped.js";
import * as s from "./db/schema/index.js";
import {
  authenticate,
  errorHandler,
  notFoundHandler,
  requestId,
  requireCsrfHeader,
  requireSite,
  SESSION_COOKIE,
  validateBody,
  validatedQuery,
  validateQuery,
} from "./middleware/core.js";
import { dataTypes, moduleDefinitions } from "./modules/registry.js";
import { readChecks } from "./trust/checks.js";
import * as releases from "./releases/service.js";
import { ValidationFailed } from "./releases/service.js";
import { getActiveRelease, parseStoredConfig } from "./repositories/releases.js";
import { manifest, mount } from "./routes/manifest.js";
import * as authSvc from "./services/auth.js";
import * as reportSvc from "./reports/service.js";
import { XLSX_MIME } from "./reports/excel.js";
import * as ops from "./services/operations.js";
import { AppError, badRequest, forbidden, notImplemented } from "./utils/errors.js";

export interface AppDeps {
  db: Database;
  env: Env;
  /** Max login attempts per window; tests raise it. */
  loginRateLimit?: number;
  log?: (msg: string, meta: Record<string, unknown>) => void;
}

export function createApp({ db, env, loginRateLimit = 10, log = () => undefined }: AppDeps): Express {
  manifest.length = 0;
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, allowedHeaders: ["content-type", "x-opshub-client", "idempotency-key", "x-request-id", "x-file-name"] }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const api = Router();
  const auth = authenticate(db, env.JWT_SECRET);
  const secureCookie = env.NODE_ENV === "production";

  // ---------- platform health (unauthenticated, no data)
  const health = mount(api);
  health.get("/health", (_req, res) => {
    res.json({ data: { status: "ok", service: "opshub-api", time: new Date().toISOString() } });
  });
  health.get("/ready", async (_req, res) => {
    const ok = await db.ping();
    res.status(ok ? 200 : 503).json({ data: { status: ok ? "ready" : "not_ready", checks: { database: ok ? "ok" : "unavailable" } } });
  });

  // ---------- authentication
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: loginRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "Too many login attempts. Try again later." } } });
  const a = mount(api, "/auth");
  api.use(requireCsrfHeader);
  a.post("/login", authLimiter, validateBody(loginRequestSchema), async (req, res) => {
    const { session, token } = await authSvc.login({ db, jwtSecret: env.JWT_SECRET, expiresInSeconds: env.JWT_EXPIRES_IN_SECONDS }, req.body, req.requestId);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookie, path: "/", maxAge: env.JWT_EXPIRES_IN_SECONDS * 1000 });
    res.json({ data: session });
  });
  a.post("/logout", auth, async (req, res) => {
    await authSvc.logout(db, req.user!.id, req.requestId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });
  a.get("/me", auth, async (req, res) => {
    res.json({ data: await authSvc.currentSession(db, req.user!, req.sessionExpiresAt!) });
  });

  // ---------- module registry
  const m = mount(api, "/modules");
  m.get("", auth, (_req, res) => {
    res.json({ data: moduleDefinitions });
  });
  m.get("/data-types", auth, (_req, res) => {
    res.json({ data: dataTypes });
  });

  // ---------- trust console (platform admins; results come from recorded test runs only)
  const trust = mount(api, "/trust");
  trust.get("/checks", auth, (req, res) => {
    if (!req.user!.isPlatformAdmin) throw forbidden();
    res.json({ data: readChecks() });
  });

  // ---------- hub administration (platform admins only)
  const hub = mount(api, "/hub");
  hub.get("/backup", auth, async (req, res) => {
    if (!req.user!.isPlatformAdmin) throw forbidden();
    if (!env.DATABASE_ADMIN_URL) throw new AppError(503, "backup_unavailable", "Backups need DATABASE_ADMIN_URL on the API host");
    const fileName = backupFileName();
    const bytes = await streamBackup(res, { adminUrl: env.DATABASE_ADMIN_URL, pgDumpPath: env.PG_DUMP_PATH, fileName });
    await db.withoutTenant((tx) => recordAudit(tx, { siteId: null, actorId: req.user!.id, action: "backup.downloaded", entityType: "database", entityId: fileName, metadata: { bytes }, requestId: req.requestId }));
  });

  // ---------- sites
  const st = mount(api, "/sites");
  st.get("", auth, async (req, res) => {
    const rows = await authSvc.currentSession(db, req.user!, req.sessionExpiresAt!);
    const summaries: SiteSummary[] = [];
    for (const mem of rows.memberships) {
      const site = await db.withTenant({ siteId: mem.siteId, userId: req.user!.id }, async (tx) => {
        const active = await getActiveRelease(tx, mem.siteId);
        const [row] = await tx.select().from(s.sites).where(eq(s.sites.id, mem.siteId));
        return active && row ? { row, cfg: parseStoredConfig(active.configuration), version: active.version } : null;
      });
      if (site) summaries.push({ id: site.row.id, slug: site.row.slug, name: site.row.name, accent: site.cfg.theme.primary, shell: site.cfg.shell, activeReleaseVersion: site.version });
    }
    res.json({ data: summaries });
  });
  st.get("/:siteId", auth, requireSite(db), async (req, res) => {
    const acc = req.siteAccess!;
    res.json({ data: { id: acc.siteId, slug: acc.siteSlug, roles: acc.roles, permissions: [...acc.permissions].sort(), activeReleaseVersion: acc.releaseVersion } });
  });
  st.get("/:siteId/config", auth, requireSite(db), async (req, res) => {
    const acc = req.siteAccess!;
    const active = await db.withTenant({ siteId: acc.siteId, userId: req.user!.id }, (tx) => getActiveRelease(tx, acc.siteId));
    if (!active) throw new AppError(404, "no_active_release", "Site has no active configuration release");
    res.json({ data: { version: active.version, configuration: parseStoredConfig(active.configuration) } });
  });

  // ---------- configuration validate / preview / draft (platform admins only)
  st.post("/:siteId/config/validate", auth, requireSite(db, "config:manage"), validateBody(configurationPayloadSchema), (req, res) => {
    res.json({ data: compileConfiguration(req.body.configuration).result });
  });
  st.post("/:siteId/config/preview", auth, requireSite(db, "config:manage"), validateBody(configurationPayloadSchema), (req, res) => {
    const { result, compiled } = compileConfiguration(req.body.configuration);
    if (!compiled || compiled.siteId !== req.siteAccess!.siteId) throw new ValidationFailed(compiled ? { ...result, valid: false, errors: [{ severity: "error", stage: "identity", code: "identity.mismatch", message: "Configuration siteId does not match the target site" }] } : result);
    res.json({ data: { validation: result, configuration: compiled } });
  });
  st.put("/:siteId/config/draft", auth, requireSite(db, "config:manage"), validateBody(configurationDraftSchema), async (req, res) => {
    res.json({ data: await releases.saveDraft(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, req.body.baseVersion, req.body.configuration) });
  });

  // ---------- releases
  const actor = (req: express.Request) => ({ userId: req.user!.id, siteId: req.siteAccess!.siteId, siteSlug: req.siteAccess!.siteSlug, requestId: req.requestId });
  st.get("/:siteId/releases", auth, requireSite(db), async (req, res) => {
    res.json({ data: await releases.history(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }) });
  });
  st.post("/:siteId/releases/publish", auth, requireSite(db, "release:publish"), validateBody(publishRequestSchema), async (req, res) => {
    res.status(201).json({ data: await releases.publish(db, actor(req), req.body) });
  });
  st.post("/:siteId/releases/rollback", auth, requireSite(db, "release:publish"), validateBody(rollbackRequestSchema), async (req, res) => {
    res.status(201).json({ data: await releases.rollback(db, actor(req), req.body) });
  });
  st.get("/:siteId/releases/:releaseId/diff", auth, requireSite(db), async (req, res) => {
    res.json({ data: await releases.diff(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, String(req.params.releaseId)) });
  });
  st.get("/:siteId/audit-events", auth, requireSite(db, "config:manage"), async (req, res) => {
    const rows = await db.withTenant({ siteId: req.siteAccess!.siteId, userId: req.user!.id }, (tx) => tx.select().from(s.auditEvents).orderBy(s.auditEvents.createdAt).limit(200));
    res.json({ data: rows.map((r) => ({ id: r.id, siteId: r.siteId, actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt.toISOString() })) });
  });

  // ---------- operations
  const opActor = (req: express.Request): ops.Actor => ({ siteId: req.siteAccess!.siteId, userId: req.user!.id, requestId: req.requestId });
  const paging = validateQuery(paginationRequestSchema);
  st.get("/:siteId/inventory", auth, requireSite(db, ["inventory:view", "request:create"]), paging, async (req, res) => {
    const p = validatedQuery<PaginationRequest>(res);
    res.json({ data: await ops.listItems(db, opActor(req), p.page, p.pageSize) });
  });
  st.get("/:siteId/inventory/reconciliation", auth, requireSite(db, "inventory:view"), async (req, res) => {
    res.json({ data: await ops.reconcileStock(db, opActor(req)) });
  });
  st.get("/:siteId/inventory/:itemId", auth, requireSite(db, "inventory:view"), async (req, res) => {
    res.json({ data: await ops.getItem(db, opActor(req), String(req.params.itemId)) });
  });
  st.get("/:siteId/requests", auth, requireSite(db, "request:view"), paging, async (req, res) => {
    const p = validatedQuery<PaginationRequest>(res);
    res.json({ data: await ops.listRequests(db, opActor(req), p.page, p.pageSize) });
  });
  st.get("/:siteId/requests/:requestId", auth, requireSite(db, "request:view"), async (req, res) => {
    res.json({ data: await ops.getRequest(db, opActor(req), String(req.params.requestId)) });
  });
  st.post("/:siteId/requests", auth, requireSite(db, "request:create"), validateBody(createRequestPayloadSchema), async (req, res) => {
    res.status(201).json({ data: await ops.createRequest(db, opActor(req), req.body) });
  });
  st.post("/:siteId/requests/:requestId/decision", auth, requireSite(db, "approval:decide"), validateBody(decideRequestPayloadSchema), async (req, res) => {
    res.json({ data: await ops.decideRequest(db, opActor(req), String(req.params.requestId), req.body.decision, req.body.comment) });
  });
  st.get("/:siteId/assignments", auth, requireSite(db, "assignment:view"), async (req, res) => {
    res.json({ data: await ops.listAssignments(db, opActor(req)) });
  });
  st.post("/:siteId/assignments", auth, requireSite(db, "assignment:create"), validateBody(createAssignmentPayloadSchema), async (req, res) => {
    const key = req.header("idempotency-key");
    if (!key || key.length < 8 || key.length > 128) throw badRequest("Idempotency-Key header (8-128 chars) is required");
    const out = await ops.assignMaterial(db, opActor(req), req.body.requestId, key);
    res.status(out.replayed ? 200 : 201).setHeader("Idempotent-Replay", String(out.replayed)).json({ data: out.assignment });
  });
  st.post("/:siteId/consumption", auth, requireSite(db, "consumption:record"), validateBody(recordConsumptionPayloadSchema), async (req, res) => {
    res.status(201).json({ data: await ops.recordConsumption(db, opActor(req), req.body.assignmentId, req.body.quantity) });
  });

  // ---------- Excel reports (role-masked export, zero-tolerance import)
  const reportActor = (req: express.Request): reportSvc.ReportActor => ({ siteId: req.siteAccess!.siteId, userId: req.user!.id, roles: req.siteAccess!.roles, requestId: req.requestId });
  st.get("/:siteId/reports", auth, requireSite(db), async (req, res) => {
    res.json({ data: await reportSvc.listReports(db, reportActor(req)) });
  });
  st.get("/:siteId/reports/:key/export", auth, requireSite(db), async (req, res) => {
    const { workbook, fileName } = await reportSvc.exportReport(db, reportActor(req), String(req.params.key));
    res.status(200);
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");
    await workbook.xlsx.write(res);
    res.end();
  });
  st.post("/:siteId/reports/:key/import", auth, requireSite(db), express.raw({ type: () => true, limit: REPORT_MAX_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest("Upload an .xlsx file as the request body");
    const rawName = req.header("x-file-name");
    let fileName = "upload.xlsx";
    try {
      if (rawName) fileName = decodeURIComponent(rawName).replace(/[^\w .()-]/g, "_").slice(0, 200);
    } catch {
      /* keep default */
    }
    const dryRun = req.query.dryRun === "true";
    const out = await reportSvc.importReport(db, reportActor(req), String(req.params.key), req.body, fileName, dryRun);
    res.status(dryRun ? 200 : 201).json({ data: out });
  });

  // ---------- documented but not yet built: honest 501s (still authenticated and site-scoped)
  const unavailable = (feature: string): RequestHandler[] => [
    auth,
    requireSite(db),
    () => {
      throw notImplemented(feature);
    },
  ];
  st.unavailable("GET", "/:siteId/returns", ...unavailable("Return management"));
  st.unavailable("POST", "/:siteId/returns", ...unavailable("Return management"));
  st.unavailable("GET", "/:siteId/repairs", ...unavailable("PCB repair"));
  st.unavailable("POST", "/:siteId/repairs", ...unavailable("PCB repair"));
  st.unavailable("GET", "/:siteId/analytics/stock-summary", ...unavailable("Analytics"));

  app.use("/api/v1", api);
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
