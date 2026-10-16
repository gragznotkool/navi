import { and, desc, eq } from "drizzle-orm";
import { siteConfigurationSchema, type SiteConfiguration } from "@opshub/contracts";
import * as s from "../db/schema/index.js";
import type { Tx } from "../db/scoped.js";

/** Active release row (version + configuration) for the tenant in `tx`, or null if none is active. */
export async function getActiveRelease(tx: Tx, siteId: string) {
  const rows = await tx
    .select({ version: s.siteReleases.version, id: s.siteReleases.id, configuration: s.siteReleases.configuration })
    .from(s.siteActiveReleases)
    .innerJoin(s.siteReleases, and(eq(s.siteReleases.id, s.siteActiveReleases.releaseId), eq(s.siteReleases.siteId, s.siteActiveReleases.siteId)))
    .where(eq(s.siteActiveReleases.siteId, siteId))
    .limit(1);
  return rows[0] ?? null;
}

/** Releases are validated on publish, but we re-parse on read: stored data is not blindly trusted. */
export function parseStoredConfig(value: unknown): SiteConfiguration {
  return siteConfigurationSchema.parse(value);
}

export async function listReleases(tx: Tx, siteId: string) {
  const active = await tx.select().from(s.siteActiveReleases).where(eq(s.siteActiveReleases.siteId, siteId));
  const activeId = active[0]?.releaseId;
  const rows = await tx
    .select({
      id: s.siteReleases.id,
      siteId: s.siteReleases.siteId,
      version: s.siteReleases.version,
      note: s.siteReleases.note,
      publishedBy: s.siteReleases.publishedBy,
      publishedAt: s.siteReleases.publishedAt,
      rolledBackToVersion: s.siteReleases.rolledBackToVersion,
    })
    .from(s.siteReleases)
    .where(eq(s.siteReleases.siteId, siteId))
    .orderBy(desc(s.siteReleases.version));
  return rows.map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString(), isActive: r.id === activeId }));
}

export async function getReleaseByVersion(tx: Tx, siteId: string, version: number) {
  const rows = await tx
    .select()
    .from(s.siteReleases)
    .where(and(eq(s.siteReleases.siteId, siteId), eq(s.siteReleases.version, version)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getReleaseById(tx: Tx, siteId: string, id: string) {
  const rows = await tx
    .select()
    .from(s.siteReleases)
    .where(and(eq(s.siteReleases.siteId, siteId), eq(s.siteReleases.id, id)))
    .limit(1);
  return rows[0] ?? null;
}
