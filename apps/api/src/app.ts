import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type Express, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import helmet from "helmet";
import { eq, sql } from "drizzle-orm";
import {
  configurationPayloadSchema,
  createAssignmentPayloadSchema,
  createRequestPayloadSchema,
  decideRequestPayloadSchema,
  loginRequestSchema,
  paginationRequestSchema,
  publishRequestSchema,
  impactRequestSchema,
  aiPatchRequestSchema,
  publicRequestSchema,
  syncRequestSchema,
  provisionSiteRequestSchema,
  updateItemFieldsPayloadSchema,
  recordConsumptionPayloadSchema,
  rollbackRequestSchema,
  configurationDraftSchema,
  type PaginationRequest,
  type SiteSummary,
} from "@opshub/contracts";
import * as excel from "./excel/service.js";
import { XLSX_MIME } from "./excel/export.js";
import { MAX_FILE_BYTES } from "./excel/zipGuard.js";
import * as syncSvc from "./services/sync.js";
import { submitPublicRequest } from "./public/intake.js";
import { proposePatch } from "./ai/service.js";
import { selectProvider, type PatchProvider } from "./ai/providers.js";
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
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  SESSION_COOKIE,
  validateBody,
  validatedQuery,
  validateQuery,
} from "./middleware/core.js";
import { dataTypes, moduleDefinitions } from "./modules/registry.js";
import { loadPresets, summarize } from "./provisioning/presets.js";
import { getSnapshot, requestProvisioning } from "./provisioning/service.js";
import { readChecks } from "./trust/checks.js";
import { lastResult, ProofBusy, proofDefinitions, runProof, UnknownProof } from "./trust/proofs.js";
import * as releases from "./releases/service.js";
import { ValidationFailed } from "./releases/service.js";
import { getActiveRelease, parseStoredConfig } from "./repositories/releases.js";
import { manifest, mount } from "./routes/manifest.js";
import * as authSvc from "./services/auth.js";
import * as ops from "./services/operations.js";
import { AppError, badRequest, forbidden, notFound, notImplemented, unauthorized } from "./utils/errors.js";

export interface AppDeps {
  db: Database;
  env: Env;
  /** Max login attempts per window; tests raise it. */
  loginRateLimit?: number;
  log?: (msg: string, meta: Record<string, unknown>) => void;
  /** Tests inject a provider; otherwise it is chosen from the environment (null = deterministic fallback). */
  aiProvider?: PatchProvider | null;
  /** Max public intake submissions per minute per client; tests raise it. */
  publicRateLimit?: number;
  /** Max AI requests per minute per client; tests raise it. */
  aiRateLimit?: number;
}

export function createApp({ db, env, loginRateLimit = 10, log = () => undefined, aiProvider, aiRateLimit = 20, publicRateLimit = 5 }: AppDeps): Express {
  manifest.length = 0;
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, allowedHeaders: ["content-type", "x-opshub-client", "idempotency-key", "x-request-id"] }));
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

  // ---------- trust console (platform admins; results come from recorded test runs only)
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
          res.write(`id: ${e.seq}
event: log
data: ${JSON.stringify(e)}

`);
          last = e.seq;
        }
        if (snap.job.status !== "running" && snap.events.length === 0) {
          res.write(`event: done
data: ${JSON.stringify(snap.job)}

`);
          break;
        }
        if (++beat % 60 === 0) res.write(`: keep-alive\n\n`);
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      res.end();
    }
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
  st.put("/:siteId/config/draft", auth, requireSite(db, "config:manage"), validateBody(configurationDraftSchema), async (req, res) => {
    res.json({ data: await releases.saveDraft(db, { siteId: req.siteAccess!.siteId, userId: req.user!.id }, req.body.baseVersion, req.body.configuration) });
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
  st.get("/:siteId/audit-events", auth, requireSite(db, "config:manage"), async (req, res) => {
    const rows = await db.withTenant({ siteId: req.siteAccess!.siteId, userId: req.user!.id }, (tx) => tx.select().from(s.auditEvents).orderBy(s.auditEvents.createdAt).limit(200));
    res.json({ data: rows.map((r) => ({ id: r.id, siteId: r.siteId, actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt.toISOString() })) });
  });

  // ---------- Bolo & Build: propose a configuration change from an utterance. Never saves or publishes.
  const aiLimiter = rateLimit({ windowMs: 60_000, limit: aiRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "Too many AI requests. Wait a minute and try again." } } });
  const provider = aiProvider === undefined ? selectProvider(env) : aiProvider;
  st.post("/:siteId/ai/patch", auth, requireSite(db, "config:manage"), aiLimiter, validateBody(aiPatchRequestSchema), async (req, res) => {
    res.json({ data: await proposePatch({ db, provider, log }, { siteId: req.siteAccess!.siteId, userId: req.user!.id, requestId: req.requestId }, req.body) });
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

  // ---------- Excel: exports of the caller's own site, and a guarded import (dry run first)
  const sendXlsx = (res: express.Response, siteSlug: string, name: string, file: Buffer) => {
    res.setHeader("content-type", XLSX_MIME);
    res.setHeader("content-disposition", `attachment; filename="${siteSlug.replace(/[^a-z0-9-]/g, "")}-${name}.xlsx"`);
    res.setHeader("cache-control", "no-store");
    res.send(file);
  };
  st.get("/:siteId/reports/inventory.xlsx", auth, requireSite(db, "inventory:view"), async (req, res) => {
    sendXlsx(res, req.siteAccess!.siteSlug, "inventory", await excel.exportInventory(db, opActor(req)));
  });
  st.get("/:siteId/reports/requests.xlsx", auth, requireSite(db, "request:view"), async (req, res) => {
    sendXlsx(res, req.siteAccess!.siteSlug, "requests", await excel.exportRequests(db, opActor(req)));
  });
  st.get("/:siteId/imports/inventory/template.xlsx", auth, requireSite(db, "inventory:manage"), async (req, res) => {
    sendXlsx(res, req.siteAccess!.siteSlug, "inventory-template", await excel.importTemplate(db, opActor(req)));
  });
  st.post("/:siteId/imports/inventory", auth, requireSite(db, "inventory:manage"), express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, "unsupported_media_type", "Send the .xlsx file as the raw request body.");
    const dryRun = req.query.dryRun !== "false"; // safe by default: only an explicit dryRun=false writes
    const key = req.header("idempotency-key");
    if (!dryRun && (!key || key.length < 8 || key.length > 128)) throw badRequest("Idempotency-Key header (8-128 chars) is required to apply an import");
    const report = await excel.importInventory(db, opActor(req), req.body, { dryRun, idempotencyKey: key });
    res.status(report.applied && !report.replayed ? 201 : 200).json({ data: report });
  });

  // ---------- offline sync: replay queued safe operations (each under its own idempotency key)
  st.post("/:siteId/sync", auth, requireSite(db), validateBody(syncRequestSchema), async (req, res) => {
    res.json({ data: { results: await syncSvc.applySync(db, opActor(req), req.siteAccess!.permissions, req.body.ops) } });
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

  // ---------- public intake (no sign-in). Exists per site only when its active release enables it; see public/intake.ts.
  const publicLimiter = rateLimit({ windowMs: 60_000, limit: publicRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "Too many submissions. Try again in a minute." } } });
  app.post("/api/public/:slug/requests", publicLimiter, validateBody(publicRequestSchema), async (req, res, next) => {
    try {
      const slug = String(req.params.slug);
      if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw notFound("Not found");
      // A filled honeypot is a bot: pretend to accept, store nothing.
      if (!req.body.website) await submitPublicRequest(db, slug, req.body, req.requestId);
      res.status(202).json({ data: { accepted: true } });
    } catch (e) {
      next(e);
    }
  });

  app.use("/api/v1", api);
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
