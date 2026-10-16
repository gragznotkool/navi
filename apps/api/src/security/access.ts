import { and, eq } from "drizzle-orm";
import type { SiteMembership } from "@opshub/contracts";
import type { Database } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";

/** Platform-level permissions that site configuration cannot grant. */
export const PLATFORM_PERMISSIONS = ["config:manage", "release:publish"] as const;

export interface SiteAccess {
  siteId: string;
  siteSlug: string;
  roles: string[];
  permissions: Set<string>;
  releaseVersion: number | null;
}

/**
 * Resolves what `userId` may do in `siteId`: explicit membership is mandatory (never trusted from
 * the client), role permissions come from the ACTIVE release's role definitions, and platform
 * admins additionally receive platform permissions. Returns null for non-members.
 */
export async function resolveSiteAccess(
  db: Database,
  user: { id: string; isPlatformAdmin: boolean },
  siteId: string,
): Promise<SiteAccess | null> {
  return db.withTenant({ siteId, userId: user.id }, async (tx) => {
    const rows = await tx
      .select({ roleKey: s.roles.key, slug: s.sites.slug })
      .from(s.userSiteRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userSiteRoles.roleId))
      .innerJoin(s.sites, eq(s.sites.id, s.userSiteRoles.siteId))
      .where(and(eq(s.userSiteRoles.userId, user.id), eq(s.userSiteRoles.siteId, siteId)));
    if (rows.length === 0) return null;

    const active = await getActiveRelease(tx, siteId);
    const permissions = new Set<string>();
    if (active) {
      const cfg = parseStoredConfig(active.configuration);
      for (const key of rows.map((r) => r.roleKey)) {
        for (const p of cfg.roles.find((r) => r.id === key)?.permissions ?? []) permissions.add(p);
      }
    }
    if (user.isPlatformAdmin) for (const p of PLATFORM_PERMISSIONS) permissions.add(p);

    return {
      siteId,
      siteSlug: rows[0]!.slug,
      roles: rows.map((r) => r.roleKey),
      permissions,
      releaseVersion: active?.version ?? null,
    };
  });
}

/** All memberships of a user, each with permissions resolved against that site's active release. */
export async function listMemberships(
  db: Database,
  user: { id: string; isPlatformAdmin: boolean },
): Promise<SiteMembership[]> {
  const siteIds = await db.withUser(user.id, async (tx) => {
    const rows = await tx.select({ siteId: s.userSiteRoles.siteId }).from(s.userSiteRoles).where(eq(s.userSiteRoles.userId, user.id));
    return [...new Set(rows.map((r) => r.siteId))];
  });
  const out: SiteMembership[] = [];
  for (const siteId of siteIds) {
    const access = await resolveSiteAccess(db, user, siteId);
    if (access) {
      out.push({ siteId, siteSlug: access.siteSlug, roles: access.roles, permissions: [...access.permissions].sort() });
    }
  }
  return out.sort((a, b) => a.siteSlug.localeCompare(b.siteSlug));
}
