import { desc, eq, sql } from "drizzle-orm";
import type { ConfigurationValidationResult, PublishRequest, ReleaseDiff, ReleaseSummary, RollbackRequest } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import { compileConfiguration } from "../compiler/compile.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease, getReleaseById, getReleaseByVersion, listReleases } from "../repositories/releases.js";
import { AppError, conflict, notFound } from "../utils/errors.js";
import { diffConfigurations } from "./diff.js";

export class ValidationFailed extends AppError {
  constructor(readonly result: ConfigurationValidationResult) {
    super(422, "configuration_invalid", "Configuration failed validation", result.errors.map((e) => ({ path: e.path ?? e.stage, message: `${e.code}: ${e.message}` })));
  }
}

interface Actor {
  userId: string;
  siteId: string;
  siteSlug: string;
  requestId: string;
}

/** Serialises publish/rollback per site so version numbers and the active pointer can't race. */
async function lockSite(tx: Tx, siteId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${siteId}))`);
}

async function nextVersion(tx: Tx, siteId: string): Promise<number> {
  const rows = await tx.select({ v: s.siteReleases.version }).from(s.siteReleases).where(eq(s.siteReleases.siteId, siteId)).orderBy(desc(s.siteReleases.version)).limit(1);
  return (rows[0]?.v ?? 0) + 1;
}

async function activate(tx: Tx, siteId: string, releaseId: string, version: number): Promise<void> {
  await tx
    .insert(s.siteActiveReleases)
    .values({ siteId, releaseId, version })
    .onConflictDoUpdate({ target: s.siteActiveReleases.siteId, set: { releaseId, version, updatedAt: new Date() } });
}

function toSummary(r: typeof s.siteReleases.$inferSelect, isActive: boolean): ReleaseSummary {
  return {
    id: r.id,
    siteId: r.siteId,
    version: r.version,
    note: r.note,
    publishedBy: r.publishedBy,
    publishedAt: r.publishedAt.toISOString(),
    rolledBackToVersion: r.rolledBackToVersion,
    isActive,
  };
}

/**
 * Validates server-side, then creates an immutable release and moves the active pointer in ONE
 * transaction. A stale `baseVersion` is rejected with 409; any failure leaves the previous release active.
 */
export async function publish(db: Database, actor: Actor, req: PublishRequest): Promise<ReleaseSummary> {
  const { result, compiled } = compileConfiguration(req.configuration);
  if (!compiled) throw new ValidationFailed(result);
  if (compiled.siteId !== actor.siteId || compiled.slug !== actor.siteSlug) {
    throw new ValidationFailed({
      valid: false,
      warnings: [],
      errors: [{ severity: "error", stage: "identity", code: "identity.mismatch", message: "Configuration siteId/slug does not match the target site" }],
    });
  }
  return db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
    await lockSite(tx, actor.siteId);
    const active = await getActiveRelease(tx, actor.siteId);
    if ((active?.version ?? null) !== req.baseVersion) {
      throw conflict("stale_draft", `Draft is based on version ${req.baseVersion ?? "none"} but the active version is ${active?.version ?? "none"}. Reload and re-apply your changes.`);
    }
    const version = await nextVersion(tx, actor.siteId);
    const [row] = await tx
      .insert(s.siteReleases)
      .values({ siteId: actor.siteId, version, configuration: compiled, note: req.note ?? null, publishedBy: actor.userId })
      .returning();
    await activate(tx, actor.siteId, row!.id, version);
    await recordAudit(tx, { siteId: actor.siteId, actorId: actor.userId, action: "release.published", entityType: "site_release", entityId: row!.id, metadata: { version, previousVersion: active?.version ?? null }, requestId: actor.requestId });
    return toSummary(row!, true);
  });
}

/** Rollback never deletes history: it publishes a NEW release whose content equals the target's. */
export async function rollback(db: Database, actor: Actor, req: RollbackRequest): Promise<ReleaseSummary> {
  return db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
    await lockSite(tx, actor.siteId);
    const active = await getActiveRelease(tx, actor.siteId);
    if ((active?.version ?? null) !== req.baseVersion) {
      throw conflict("stale_draft", `Active version is ${active?.version ?? "none"}, not ${req.baseVersion ?? "none"}. Reload before rolling back.`);
    }
    const target = await getReleaseByVersion(tx, actor.siteId, req.targetVersion);
    if (!target) throw notFound(`Release version ${req.targetVersion} not found`);
    // Re-validate: a registry change since publication must not silently activate an invalid config.
    const { result, compiled } = compileConfiguration(target.configuration);
    if (!compiled) throw new ValidationFailed(result);
    const version = await nextVersion(tx, actor.siteId);
    const [row] = await tx
      .insert(s.siteReleases)
      .values({ siteId: actor.siteId, version, configuration: compiled, note: `Rollback to version ${target.version}`, publishedBy: actor.userId, rolledBackToVersion: target.version })
      .returning();
    await activate(tx, actor.siteId, row!.id, version);
    await recordAudit(tx, { siteId: actor.siteId, actorId: actor.userId, action: "release.rolled-back", entityType: "site_release", entityId: row!.id, metadata: { version, targetVersion: target.version, previousVersion: active?.version ?? null }, requestId: actor.requestId });
    return toSummary(row!, true);
  });
}

export function history(db: Database, actor: { siteId: string; userId: string }): Promise<ReleaseSummary[]> {
  return db.withTenant(actor, (tx) => listReleases(tx, actor.siteId));
}

/** Diff of a release against its predecessor (or against nothing for version 1). */
export async function diff(db: Database, actor: { siteId: string; userId: string }, releaseId: string): Promise<ReleaseDiff> {
  return db.withTenant(actor, async (tx) => {
    const release = await getReleaseById(tx, actor.siteId, releaseId);
    if (!release) throw notFound("Release not found");
    const previous = release.version > 1 ? await getReleaseByVersion(tx, actor.siteId, release.version - 1) : null;
    return {
      fromVersion: previous?.version ?? null,
      toVersion: release.version,
      entries: diffConfigurations(previous?.configuration ?? {}, release.configuration),
    };
  });
}

// NEW: Preview a release configuration (read‑only)
export async function preview(db: Database, actor: { siteId: string; userId: string }, releaseId: string): Promise<{ version: number; configuration: unknown }> {
  return db.withTenant(actor, async (tx) => {
    const release = await getReleaseById(tx, actor.siteId, releaseId);
    if (!release) throw notFound("Release not found");
    // Return stored snapshot (immutable)
    return { version: release.version, configuration: release.configuration };
  });
}

// NEW: Determine if a rollback is allowed for a target release
export async function rollbackEligibility(
  db: Database,
  actor: { siteId: string; userId: string },
  targetVersion: number,
  baseVersion: number
): Promise<{ eligible: boolean; warnings?: string[]; blockingReasons?: string[] }> {
  return db.withTenant(actor, async (tx) => {
    const active = await getActiveRelease(tx, actor.siteId);
    if ((active?.version ?? null) !== baseVersion) {
      return { eligible: false, blockingReasons: ["Active version mismatch – reload before attempting rollback."] };
    }
    const target = await getReleaseByVersion(tx, actor.siteId, targetVersion);
    if (!target) {
      return { eligible: false, blockingReasons: [`Target release version ${targetVersion} not found`] };
    }
    const { result, compiled } = compileConfiguration(target.configuration);
    if (!compiled) {
      return { eligible: false, blockingReasons: result.errors.map((e) => `${e.code}: ${e.message}`) };
    }
    // Additional compatibility checks could be added here
    return { eligible: true };
  });
}


export async function saveDraft(db: Database, actor: { siteId: string; userId: string }, baseVersion: number | null, configuration: unknown): Promise<{ savedAt: string; validation: ConfigurationValidationResult }> {
  const { result } = compileConfiguration(configuration);
  return db.withTenant(actor, async (tx) => {
    const active = await getActiveRelease(tx, actor.siteId);
    if ((active?.version ?? null) !== baseVersion) {
      throw conflict("stale_draft", `Draft is based on version ${baseVersion ?? "none"} but the active version is ${active?.version ?? "none"}.`);
    }
    const now = new Date();
    await tx
      .insert(s.siteDrafts)
      .values({ siteId: actor.siteId, baseVersion, configuration: configuration ?? null, updatedBy: actor.userId, updatedAt: now })
      .onConflictDoUpdate({ target: s.siteDrafts.siteId, set: { baseVersion, configuration: configuration ?? null, updatedBy: actor.userId, updatedAt: now } });
    await recordAudit(tx, { siteId: actor.siteId, actorId: actor.userId, action: "draft.saved", entityType: "site_draft", entityId: actor.siteId, metadata: { valid: result.valid } });
    return { savedAt: now.toISOString(), validation: result };
  });
}
