import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { ProvisioningEvent, ProvisioningJob, ProvisioningSnapshot, ProvisionSiteRequest, SiteConfiguration } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import { compileConfiguration } from "../compiler/compile.js";
import type { Database } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { ValidationFailed } from "../releases/service.js";
import { AppError, conflict, notFound } from "../utils/errors.js";
import { buildConfiguration, getPreset, roleIdsOf } from "./presets.js";

/** A running job that has not been touched for this long was abandoned (e.g. the server restarted). */
const STALE_MS = 2 * 60_000;

export interface ProvisionDeps {
  db: Database;
  /** Pause between steps; lets a human watch the live log. 0 in tests. */
  stepDelayMs: number;
  log?: (msg: string, meta: Record<string, unknown>) => void;
}
export interface ProvisionActor {
  userId: string;
  requestId: string;
}

type StoredInput = { name: string; preset: string; adminEmail: string | null; demoStock: boolean };
/** jsonb does not preserve key order, so compare field by field. */
const sameInput = (a: unknown, b: StoredInput): boolean => {
  const x = a as StoredInput;
  return x.name === b.name && x.preset === b.preset && x.adminEmail === b.adminEmail && x.demoStock === b.demoStock;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type JobRow = typeof s.provisioningJobs.$inferSelect;

function toJob(r: JobRow): ProvisioningJob {
  const input = r.input as Pick<ProvisionSiteRequest, "name" | "preset">;
  const stale = r.status === "running" && Date.now() - r.updatedAt.getTime() > STALE_MS;
  return {
    id: r.id,
    slug: r.slug,
    name: input.name,
    preset: input.preset,
    status: stale ? "failed" : r.status,
    error: stale ? "Provisioning was interrupted (the server restarted). Run it again to retry." : r.error,
    createdAt: r.createdAt.toISOString(),
  };
}
const isStale = (r: JobRow) => r.status === "running" && Date.now() - r.updatedAt.getTime() > STALE_MS;

async function emit(db: Database, jobId: string, level: ProvisioningEvent["level"], message: string): Promise<void> {
  await db.withoutTenant(async (tx) => {
    const [{ next } = { next: 1 }] = await tx.select({ next: sql<number>`coalesce(max(${s.provisioningEvents.seq}), 0) + 1` }).from(s.provisioningEvents).where(eq(s.provisioningEvents.jobId, jobId));
    await tx.insert(s.provisioningEvents).values({ jobId, seq: next, level, message });
    await tx.update(s.provisioningJobs).set({ updatedAt: new Date() }).where(eq(s.provisioningJobs.id, jobId));
  });
}

export async function getSnapshot(db: Database, jobId: string, afterSeq = 0): Promise<ProvisioningSnapshot> {
  return db.withoutTenant(async (tx) => {
    const [job] = await tx.select().from(s.provisioningJobs).where(eq(s.provisioningJobs.id, jobId));
    if (!job) throw notFound("Provisioning job not found");
    const events = await tx
      .select()
      .from(s.provisioningEvents)
      .where(and(eq(s.provisioningEvents.jobId, jobId), gt(s.provisioningEvents.seq, afterSeq)))
      .orderBy(asc(s.provisioningEvents.seq));
    return { job: toJob(job), events: events.map((e) => ({ seq: e.seq, level: e.level as ProvisioningEvent["level"], message: e.message, at: e.at.toISOString() })) };
  });
}

/** Turns internal failures into a message that is safe and useful to show in the live log. */
function friendly(e: unknown, slug: string): string {
  const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
  if (code === "23505") return `The address “${slug}” is already used by another site.`;
  if (e instanceof ValidationFailed) return `The preset did not pass validation: ${e.result.errors.map((x) => x.message).join("; ")}`;
  if (e instanceof AppError) return e.message;
  return "An unexpected error occurred.";
}

const DEMO_STOCK = [
  { sku: "DEMO-001", name: "Demo item A", unit: "each", qty: 100, reorder: 20 },
  { sku: "DEMO-002", name: "Demo item B", unit: "each", qty: 50, reorder: 10 },
  { sku: "DEMO-003", name: "Demo item C", unit: "kit", qty: 25, reorder: 5 },
];

/**
 * Creates the job (idempotent by slug) and starts it in the background. Returns immediately so the
 * caller can follow the live log. `created` is false when an identical request is already known.
 */
export async function requestProvisioning(deps: ProvisionDeps, actor: ProvisionActor, input: ProvisionSiteRequest): Promise<{ job: ProvisioningJob; created: boolean }> {
  const preset = getPreset(input.preset);
  if (!preset) throw new AppError(422, "unknown_preset", `Unknown preset “${input.preset}”`);

  const email = input.adminEmail?.trim().toLowerCase();
  const adminUser = email ? await deps.db.withoutTenant(async (tx) => (await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email)).limit(1))[0]) : undefined;
  if (email && !adminUser) throw new AppError(422, "unknown_user", `No account exists for ${email}. Ask them to be added first.`);

  // Sites the acting admin can see (RLS hides the rest; the database unique constraint is the backstop).
  const taken = await deps.db.withUser(actor.userId, async (tx) => (await tx.select({ id: s.sites.id }).from(s.sites).where(eq(s.sites.slug, input.slug)).limit(1))[0]);
  const stored = { name: input.name, preset: input.preset, adminEmail: email ?? null, demoStock: input.demoStock };

  const inserted = await deps.db.withoutTenant(async (tx) => {
    if (taken) {
      const [job] = await tx.select().from(s.provisioningJobs).where(eq(s.provisioningJobs.slug, input.slug));
      if (!(job && job.status === "succeeded" && sameInput(job.input, stored))) throw conflict("slug_taken", `The address “${input.slug}” is already used by another site.`);
    }
    const rows = await tx.insert(s.provisioningJobs).values({ slug: input.slug, input: stored, requestedBy: actor.userId }).onConflictDoNothing({ target: s.provisioningJobs.slug }).returning();
    if (rows[0]) return { row: rows[0], created: true };
    const [existing] = await tx.select().from(s.provisioningJobs).where(eq(s.provisioningJobs.slug, input.slug)).for("update");
    if (!existing) throw conflict("slug_taken", "Please try again.");
    if (existing.status === "failed" || isStale(existing)) {
      // Retry of a failed attempt: same job, new run; the log keeps the history.
      const [row] = await tx.update(s.provisioningJobs).set({ status: "running", error: null, input: stored, requestedBy: actor.userId, updatedAt: new Date() }).where(eq(s.provisioningJobs.id, existing.id)).returning();
      return { row: row!, created: true };
    }
    if (sameInput(existing.input, stored)) return { row: existing, created: false };
    throw conflict("slug_taken", `The address “${input.slug}” is already being used by another provisioning request.`);
  });

  if (inserted.created) void execute(deps, inserted.row.id, actor, input, adminUser?.id).catch((e) => deps.log?.("provisioning crashed", { jobId: inserted.row.id, message: String(e) }));
  return { job: toJob(inserted.row), created: inserted.created };
}

async function execute(deps: ProvisionDeps, jobId: string, actor: ProvisionActor, input: ProvisionSiteRequest, extraAdminId: string | undefined): Promise<void> {
  const { db } = deps;
  const preset = getPreset(input.preset)!;
  const siteId = randomUUID();
  const say = (level: ProvisioningEvent["level"], msg: string) => emit(db, jobId, level, msg);
  const pause = () => (deps.stepDelayMs > 0 ? sleep(deps.stepDelayMs) : Promise.resolve());

  try {
    await say("info", `Starting: “${input.name}” (${input.slug}) from the “${preset.label}” preset.`);
    await db.withTenant({ siteId, userId: actor.userId }, async (tx) => {
      // 1. Site record.
      await say("info", "Creating the site record…");
      await tx.insert(s.sites).values({ id: siteId, slug: input.slug, name: input.name });
      await pause();
      await say("success", "Site record created.");

      // 2. Compile and validate the preset BEFORE anything depends on it.
      await say("info", "Compiling and validating the preset configuration…");
      const { result, compiled } = compileConfiguration(buildConfiguration(preset, { siteId, slug: input.slug, name: input.name }));
      if (!compiled) throw new ValidationFailed(result);
      await pause();
      await say("success", `Configuration is valid (${compiled.modules.nodes.length} modules, ${result.warnings.length} warnings).`);

      // 3. Roles referenced by the configuration must exist.
      await say("info", "Checking roles…");
      const wanted = roleIdsOf(compiled);
      const known = await tx.select().from(s.roles).where(inArray(s.roles.key, wanted));
      const missing = wanted.filter((k) => !known.some((r) => r.key === k));
      if (missing.length) throw new AppError(422, "unknown_roles", `The preset uses roles that are not defined on this platform: ${missing.join(", ")}.`);
      const adminRole = known.find((r) => r.key === "admin");
      if (!adminRole) throw new AppError(422, "no_admin_role", "The preset must define an “admin” role.");
      await pause();
      await say("success", `Roles ready: ${wanted.join(", ")}.`);

      // 4. Release v1 and the active pointer.
      await say("info", "Publishing release v1…");
      const [release] = await tx.insert(s.siteReleases).values({ siteId, version: 1, configuration: compiled satisfies SiteConfiguration, note: `Provisioned from preset “${preset.id}”`, publishedBy: actor.userId }).returning({ id: s.siteReleases.id });
      await tx.insert(s.siteActiveReleases).values({ siteId, releaseId: release!.id, version: 1 });
      await recordAudit(tx, { siteId, actorId: actor.userId, action: "release.published", entityType: "site_release", entityId: release!.id, metadata: { version: 1, preset: preset.id }, configVersion: 1, requestId: actor.requestId });
      await pause();
      await say("success", "Release v1 is active.");

      // 5. Access: the requesting admin and (optionally) one more administrator.
      await say("info", "Granting administrator access…");
      const admins = [...new Set([actor.userId, ...(extraAdminId ? [extraAdminId] : [])])];
      await tx.insert(s.userSiteRoles).values(admins.map((userId) => ({ userId, siteId, roleId: adminRole.id })));
      await pause();
      await say("success", `${admins.length} administrator${admins.length === 1 ? "" : "s"} added.`);

      // 6. Optional demo stock, each with an opening-balance ledger row.
      if (input.demoStock) {
        await say("info", "Adding demo stock…");
        for (const it of DEMO_STOCK) {
          const [row] = await tx.insert(s.inventoryItems).values({ siteId, sku: it.sku, name: it.name, unit: it.unit, onHand: it.qty, reorderLevel: it.reorder }).returning({ id: s.inventoryItems.id });
          await tx.insert(s.stockLedger).values({ siteId, itemId: row!.id, delta: it.qty, balanceAfter: it.qty, reason: "opening-balance", refType: "provisioning", refId: row!.id, actorId: actor.userId, configVersion: 1 });
        }
        await pause();
        await say("success", `${DEMO_STOCK.length} demo items added with opening balances.`);
      } else {
        await say("info", "Demo stock skipped.");
      }

      await recordAudit(tx, { siteId, actorId: actor.userId, action: "site.provisioned", entityType: "site", entityId: siteId, metadata: { preset: preset.id, slug: input.slug, demoStock: input.demoStock }, configVersion: 1, requestId: actor.requestId });
    });

    // The final event comes first so a reader that sees "succeeded" has already seen the whole log.
    await say("success", "Committed. The site is live and appears in the hub.");
    await db.withoutTenant((tx) => tx.update(s.provisioningJobs).set({ status: "succeeded", error: null, updatedAt: new Date() }).where(eq(s.provisioningJobs.id, jobId)));
  } catch (e) {
    const message = friendly(e, input.slug);
    deps.log?.("provisioning failed", { jobId, slug: input.slug, error: e instanceof Error ? e.message : String(e) });
    await say("error", `Failed: ${message}`);
    await say("error", "Everything was rolled back. No site was created.");
    await db.withoutTenant((tx) => tx.update(s.provisioningJobs).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(s.provisioningJobs.id, jobId)));
  }
}
