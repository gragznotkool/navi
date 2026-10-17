import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type Express, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  configurationPayloadSchema,
  createAssignmentPayloadSchema,
  createRepairPayloadSchema,
  createRequestPayloadSchema,
  createReturnPayloadSchema,
  decideRequestPayloadSchema,
  impactRequestSchema,
  loginRequestSchema,
  paginationRequestSchema,
  provisionSiteRequestSchema,
  publishRequestSchema,
  recordConsumptionPayloadSchema,
  rollbackRequestSchema,
  updateItemFieldsPayloadSchema,
  updateRepairStatusPayloadSchema,
  updateReturnStatusPayloadSchema,
  updateWebsiteAccessRequestSchema,
  websiteDeployRequestSchema,
  configurationDraftSchema,
  generateProposalRequestSchema,
  updateProposalRequestSchema,
  approveProposalRequestSchema,
  publishProposalRequestSchema,
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
import { ProposalService } from "./services/proposalService.js";
import {
  authenticate,
  errorHandler,
  notFoundHandler,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
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
import { lastResult, proofDefinitions, ProofBusy, runProof, UnknownProof } from "./trust/proofs.js";
import { tenantIsolationCheck, inventoryIntegrityCheck, recentAuditEvents } from "./trust/verification.js";
import { getSnapshot, requestProvisioning } from "./provisioning/service.js";
import { loadPresets, summarize } from "./provisioning/presets.js";
import * as releases from "./releases/service.js";
import { ValidationFailed } from "./releases/service.js";
import { getActiveRelease, parseStoredConfig } from "./repositories/releases.js";
import { manifest, mount } from "./routes/manifest.js";
import * as authSvc from "./services/auth.js";
import * as reportSvc from "./reports/service.js";
import { XLSX_MIME } from "./reports/excel.js";
import * as ops from "./services/operations.js";
import { getWebsiteAccess, listPlatformUsers, listWebsites, updateWebsiteAccess } from "./websites/access.js";
import { deployWebsite } from "./websites/deploy.js";
import { listWebsiteTemplates } from "./websites/templates.js";
import { AppError, badRequest, forbidden, notFound, unauthorized } from "./utils/errors.js";

/** Every website-builder endpoint lives under one of these prefixes (see the guard in createApp). */
export const WEBSITE_BUILDER_PATHS = ["/hub/website-builder", "/hub/website-templates", "/hub/users", "/hub/websites"];

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
  // A malformed id can never match a row: answer 404 instead of letting the database reject it (500).
  for (const name of ["itemId", "requestId", "releaseId", "jobId"]) {
    api.param(name, (_req, _res, next, value: string) => (z.string().uuid().safeParse(value).success ? next() : next(notFound("Not found"))));
  }
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
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: loginRateLimit, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "Too many login attempts. Try again later." } } });
  const refreshLimiter = rateLimit({ windowMs: 15 * 60_000, limit: loginRateLimit * 12, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "Too many refresh attempts. Try again later." } } });
  const authDeps = { db, jwtSecret: env.JWT_SECRET, expiresInSeconds: env.JWT_EXPIRES_IN_SECONDS, refreshExpiresInSeconds: env.REFRESH_EXPIRES_IN_SECONDS };
  const setAuthCookies = (res: express.Response, issued: authSvc.IssuedSession) => {
    res.cookie(SESSION_COOKIE, issued.token, { httpOnly: true, sameSite: "lax", secure: secureCookie, path: "/", maxAge: env.JWT_EXPIRES_IN_SECONDS * 1000 });
    res.cookie(REFRESH_COOKIE, issued.refreshToken, { httpOnly: true, sameSite: "strict", secure: secureCookie, path: REFRESH_COOKIE_PATH, expires: issued.refreshExpiresAt });
  };
  const clearAuthCookies = (res: express.Response) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  };
  const a = mount(api, "/auth");
  api.use(requireCsrfHeader);
  a.post("/login", authLimiter, validateBody(loginRequestSchema), async (req, res) => {
    const issued = await authSvc.login(authDeps, req.body, req.requestId);
    setAuthCookies(res, issued);
    res.json({ data: issued.session });
  });
  a.post("/refresh", refreshLimiter, async (req, res) => {
    const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    if (!raw || raw.length > 200) {
      clearAuthCookies(res);
      throw unauthorized("Session expired. Sign in again.");
    }
    try {
      const issued = await authSvc.refresh(authDeps, raw, req.requestId);
      setAuthCookies(res, issued);
      res.json({ data: issued.session });
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  });
  a.post("/logout", auth, async (req, res) => {
    await authSvc.logout(db, req.user!.id, req.requestId);
    clearAuthCookies(res);
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

  // ---------- trust console (platform admins)
  const trust = mount(api, "/trust");
  trust.get("/checks", auth, (req, res) => {
    if (!req.user!.isPlatformAdmin) throw forbidden();
    res.json({ data: readChecks() });
  });
  const adminOnly: RequestHandler = (req, _res, next) => (req.user?.isPlatformAdmin ? next() : next(forbidden()));
  trust.get("/proofs", auth, adminOnly, async (_req, res) => {
    const url = new URL(env.DATABASE_URL);
    const role = await db.withoutTenant(async (tx) => (await tx.execute<{ who: string }>(sql`select current_user as who`)).rows[0]!.who);
    res.json({
      data: {
        environment: {
          nodeEnv: env.NODE_ENV,
          database: `${url.hostname}:${url.port || "5432"}${url.pathname}`,
          databaseRole: role,
          labSite: "trust-lab (reserved system site)",
          note: "Proofs run live in THIS API's environment against the reserved lab site, using the same database role the API uses. They show these controls working right now; they are not production monitoring.",
        },
        proofs: proofDefinitions.map((definition) => ({ definition, last: lastResult(definition.id) })),
      },
    });
  });
  trust.post("/proofs/:id/run", auth, adminOnly, async (req, res) => {
    try {
      res.json({ data: await runProof(String(req.params.id), { db, connectionString: env.DATABASE_URL, actorId: req.user!.id }) });
    } catch (e) {
      if (e instanceof UnknownProof) throw notFound("Unknown proof");
      if (e instanceof ProofBusy) throw new AppError(409, "proof_running", "This proof is already running");
      throw e;
    }
  });

  // Trust console additional endpoints (platform admins only)
  trust.get("/summary", auth, adminOnly, async (req, res) => {
    const isolation = await tenantIsolationCheck(db, req.user!.id);
    const inventory = await inventoryIntegrityCheck(db);
    res.json({ data: { generatedAt: new Date().toISOString(), isolation, inventory } });
  });

  trust.get("/isolation-check", auth, adminOnly, async (req, res) => {
    const result = await tenantIsolationCheck(db, req.user!.id);
    await db.withoutTenant(async (tx) => {
      await recordAudit(tx, {
        siteId: null,
        actorId: req.user!.id,
        action: "trust.isolation-check",
        entityType: "trust",
        metadata: { passed: result.passed, detail: result.detail },
        requestId: req.requestId,
      });
    });
    res.json({ data: result });
  });

  trust.get("/inventory-check", auth, adminOnly, async (req, res) => {
    const result = await inventoryIntegrityCheck(db);
    await db.withoutTenant(async (tx) => {
      await recordAudit(tx, {
        siteId: null,
        actorId: req.user!.id,
        action: "trust.inventory-check",
        entityType: "trust",
        metadata: { passed: result.passed, detail: result.detail },
        requestId: req.requestId,
      });
    });
    res.json({ data: result });
  });

  trust.get("/audit-events", auth, adminOnly, async (_req, res) => {
    const events = await recentAuditEvents(db);
    res.json({ data: events });
  });

  // ---------- one-save provisioning (platform admins)
  const prov = mount(api, "/provisioning");
  const provDeps = { db, stepDelayMs: env.PROVISIONING_STEP_DELAY_MS, log };
  prov.get("/presets", auth, adminOnly, (_req, res) => {
    res.json({ data: loadPresets().map(summarize) });
  });
  prov.get("/:jobId/events", auth, adminOnly, async (req, res) => {
    const jobId = z.string().uuid().safeParse(req.params.jobId);
    if (!jobId.success) throw notFound("Provisioning job not found");
    const after = Math.max(0, Number(req.query.after ?? req.header("last-event-id") ?? 0) || 0);
    if (!req.header("accept")?.includes("text/event-stream")) {
      // Polling fallback: same data as one JSON snapshot.
      res.json({ data: await getSnapshot(db, jobId.data, after) });
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    let closed = false;
    req.on("close", () => (closed = true));
    let last = after;
    let beat = 0;
    const deadline = Date.now() + 5 * 60_000;
    try {
      while (!closed && Date.now() < deadline) {
        const snap = await getSnapshot(db, jobId.data, last);
        for (const e of snap.events) {
          res.write(`id: ${e.seq}\nevent: log\ndata: ${JSON.stringify(e)}\n\n`);
          last = e.seq;
        }
        if (snap.job.status !== "running" && snap.events.length === 0) {
          res.write(`event: done\ndata: ${JSON.stringify(snap.job)}\n\n`);
          break;
        }
        if (++beat % 60 === 0) res.write(`: keep-alive\n\n`);
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      res.end();
    }
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
  hub.get("/overview", auth, async (req, res) => {
    res.json({ data: await ops.getHubOverview(db, req.user!.id) });
  });
  hub.get("/search", auth, async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    res.json({ data: await ops.searchCrossSite(db, req.user!.id, q) });
  });

  // ---------- website builder: templates, one-click deploy, access control
  // PLATFORM ADMINS ONLY. One guard covers every path (and any added later) under these prefixes,
  // so a new website-builder endpoint cannot be exposed to other users by forgetting a middleware.
  api.use(WEBSITE_BUILDER_PATHS, auth, adminOnly);
  // Which site's builder shows the website builder. Only that site, and only for platform admins.
  hub.get("/website-builder", auth, adminOnly, async (req, res) => {
    // Read as the admin: site rows are visible to their members only (RLS).
    const [host] = await db.withUser(req.user!.id, (tx) => tx.select({ id: s.sites.id, slug: s.sites.slug }).from(s.sites).where(eq(s.sites.slug, env.WEBSITE_BUILDER_SITE)).limit(1));
    res.json({ data: { siteId: host?.id ?? null, slug: env.WEBSITE_BUILDER_SITE } });
  });
  hub.get("/website-templates", auth, adminOnly, (_req, res) => {
    res.json({ data: listWebsiteTemplates() });
  });
  hub.get("/users", auth, adminOnly, async (_req, res) => {
    res.json({ data: await listPlatformUsers(db) });
  });
  hub.get("/websites", auth, adminOnly, async (req, res) => {
    res.json({ data: await listWebsites(db, req.user!.id) });
  });
  hub.post("/websites/deploy", auth, adminOnly, validateBody(websiteDeployRequestSchema), async (req, res) => {
    const out = await deployWebsite(provDeps, { userId: req.user!.id, requestId: req.requestId }, req.body);
    res.status(out.created ? 202 : 200).json({ data: out });
  });
  hub.get("/websites/:siteId/access", auth, adminOnly, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await getWebsiteAccess(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }) });
  });
  hub.patch("/websites/:siteId/access", auth, adminOnly, requireSite(db, "config:manage"), validateBody(updateWebsiteAccessRequestSchema), async (req, res) => {
    res.json({ data: await updateWebsiteAccess(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id, requestId: req.requestId }, req.body.access) });
  });


  // ---------- sites
  const st = mount(api, "/sites");
  st.post("", auth, adminOnly, validateBody(provisionSiteRequestSchema), async (req, res) => {
    const { job, created } = await requestProvisioning(provDeps, { userId: req.user!.id, requestId: req.requestId }, req.body);
    res.status(created ? 202 : 200).json({ data: job });
  });
  st.get("", auth, async (req, res) => {
    const rows = await authSvc.currentSession(db, req.user!, req.sessionExpiresAt!);
    const summaries: SiteSummary[] = [];
    for (const mem of rows.memberships) {
      const site = await db.withTenant({ siteId: mem.siteId, userId: req.user!.id }, async (tx) => {
        const active = await getActiveRelease(tx, mem.siteId);
        const [row] = await tx.select().from(s.sites).where(eq(s.sites.id, mem.siteId));
        return active && row && !row.isSystem ? { row, cfg: parseStoredConfig(active.configuration), version: active.version } : null;
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
  st.get("/:siteId/config/draft", auth, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await releases.getDraft(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }) });
  });
  st.put("/:siteId/config/draft", auth, requireSite(db, "config:manage"), validateBody(configurationDraftSchema), async (req, res) => {
    res.json({ data: await releases.saveDraft(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, req.body.baseVersion, req.body.configuration) });
  });
  st.delete("/:siteId/config/draft", auth, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await releases.discardDraft(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }) });
  });

  // ---------- releases
  const actor = (req: express.Request) => ({ userId: req.user!.id, siteId: req.siteAccess!.siteId, siteSlug: req.siteAccess!.siteSlug, requestId: req.requestId });
  st.get("/:siteId/releases", auth, requireSite(db), async (req, res) => {
    res.json({ data: await releases.history(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }) });
  });
  st.post("/:siteId/releases/impact", auth, requireSite(db, "release:publish"), validateBody(impactRequestSchema), async (req, res) => {
    res.json({ data: await releases.previewImpact(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, req.body) });
  });
  st.get("/:siteId/releases/:releaseId", auth, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await releases.getRelease(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, String(req.params.releaseId)) });
  });
  st.get("/:siteId/releases/:releaseId/summary", auth, requireSite(db), async (req, res) => {
    res.json({ data: await releases.summary(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, String(req.params.releaseId)) });
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
  // Preview a historical release (read‑only)
  st.get("/:siteId/releases/:releaseId/preview", auth, requireSite(db), async (req, res) => {
    const data = await releases.preview(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, String(req.params.releaseId));
    res.json({ data });
  });
  // Check rollback eligibility
  st.get("/:siteId/releases/:releaseId/rollback-eligibility", auth, requireSite(db), async (req, res) => {
    const baseVersion = Number(req.query.baseVersion);
    if (Number.isNaN(baseVersion)) throw badRequest("baseVersion query param required");
    const result = await releases.rollbackEligibility(
      db,
      { siteId: req.siteAccess!.siteId, userId: req.user!.id },
      Number(req.params.releaseId),
      baseVersion
    );
    res.json({ data: result });
  });
  st.get("/:siteId/audit-events", auth, requireSite(db, "config:manage"), async (req, res) => {
    const rows = await db.withTenant({ siteId: req.siteAccess!.siteId, userId: req.user!.id }, (tx) => tx.select().from(s.auditEvents).orderBy(s.auditEvents.createdAt).limit(200));
    res.json({ data: rows.map((r) => ({ id: r.id, siteId: r.siteId, actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt.toISOString() })) });
  });

  // ---------- Bolo & Build Proposals (AI-powered configuration proposals)
  const proposalService = new ProposalService(db);
  const proposalActor = (req: express.Request) => ({
    userId: req.user!.id,
    siteId: req.siteAccess!.siteId,
    siteSlug: req.siteAccess!.siteSlug,
    requestId: req.requestId,
    isPlatformAdmin: req.user!.isPlatformAdmin,
  });

  st.post("/:siteId/proposals", auth, requireSite(db, "config:manage"), validateBody(generateProposalRequestSchema), async (req, res) => {
    res.status(201).json({ data: await proposalService.createFromPrompt(proposalActor(req), req.body) });
  });

  st.get("/:siteId/proposals", auth, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await proposalService.listProposals(proposalActor(req)) });
  });

  st.get("/:siteId/proposals/:proposalId", auth, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await proposalService.getProposal(proposalActor(req), String(req.params.proposalId)) });
  });

  st.patch("/:siteId/proposals/:proposalId", auth, requireSite(db, "config:manage"), validateBody(updateProposalRequestSchema), async (req, res) => {
    res.json({ data: await proposalService.updateProposal(proposalActor(req), String(req.params.proposalId), req.body) });
  });

  st.post("/:siteId/proposals/:proposalId/submit", auth, requireSite(db, "config:manage"), async (req, res) => {
    res.json({ data: await proposalService.submitForApproval(proposalActor(req), String(req.params.proposalId)) });
  });

  st.post("/:siteId/proposals/:proposalId/decision", auth, requireSite(db, "release:publish"), validateBody(approveProposalRequestSchema), async (req, res) => {
    res.json({ data: await proposalService.decideProposal(proposalActor(req), String(req.params.proposalId), req.body) });
  });

  st.post("/:siteId/proposals/:proposalId/publish", auth, requireSite(db, "release:publish"), validateBody(publishProposalRequestSchema), async (req, res) => {
    res.status(201).json({ data: await proposalService.publishProposal(proposalActor(req), String(req.params.proposalId), req.body) });
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
  st.patch("/:siteId/inventory/:itemId", auth, requireSite(db, "inventory:manage"), validateBody(updateItemFieldsPayloadSchema), async (req, res) => {
    res.json({ data: await ops.updateItemExtras(db, opActor(req), String(req.params.itemId), req.body.extras) });
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

  // ---------- returns (Feature 3)
  st.get("/:siteId/returns", auth, requireSite(db, "return:view"), paging, async (req, res) => {
    const p = validatedQuery<PaginationRequest>(res);
    res.json({ data: await ops.listReturns(db, opActor(req), p.page, p.pageSize) });
  });
  st.post("/:siteId/returns", auth, requireSite(db, ["return:view", "return:process"]), validateBody(createReturnPayloadSchema), async (req, res) => {
    res.status(201).json({ data: await ops.createReturn(db, opActor(req), req.body) });
  });
  st.patch("/:siteId/returns/:returnId/status", auth, requireSite(db, "return:process"), validateBody(updateReturnStatusPayloadSchema), async (req, res) => {
    res.json({ data: await ops.updateReturnStatus(db, opActor(req), String(req.params.returnId), req.body.status) });
  });

  // ---------- repairs (Feature 2)
  st.get("/:siteId/repairs", auth, requireSite(db, "repair:view"), paging, async (req, res) => {
    const p = validatedQuery<PaginationRequest>(res);
    res.json({ data: await ops.listRepairs(db, opActor(req), p.page, p.pageSize) });
  });
  st.post("/:siteId/repairs", auth, requireSite(db, "repair:update"), validateBody(createRepairPayloadSchema), async (req, res) => {
    res.status(201).json({ data: await ops.createRepair(db, opActor(req), req.body) });
  });
  st.patch("/:siteId/repairs/:repairId/status", auth, requireSite(db, "repair:update"), validateBody(updateRepairStatusPayloadSchema), async (req, res) => {
    res.json({ data: await ops.updateRepairStatus(db, opActor(req), String(req.params.repairId), req.body.status) });
  });

  // ---------- analytics & reports
  st.get("/:siteId/analytics/stock-summary", auth, requireSite(db, "analytics:view"), async (req, res) => {
    res.json({ data: await ops.getStockSummary(db, opActor(req)) });
  });
  st.get("/:siteId/reports/inventory.xlsx", auth, requireSite(db, ["reports:view", "reports:export"]), async (req, res) => {
    const buffer = await ops.generateInventoryExcel(db, opActor(req));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="inventory-${req.siteAccess!.siteSlug}.xlsx"`);
    res.send(buffer);
  });

  app.use("/api/v1", api);
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
