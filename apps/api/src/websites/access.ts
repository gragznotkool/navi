import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { websitePath, type DeployedWebsite, type PlatformUser, type WebsiteAccess, type WebsiteAccessEntry } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
import { AppError, notFound } from "../utils/errors.js";

export async function listPlatformUsers(db: Database): Promise<PlatformUser[]> {
  const rows = await db.withoutTenant((tx) =>
    tx.select({ id: s.users.id, email: s.users.email, displayName: s.users.displayName, isPlatformAdmin: s.users.isPlatformAdmin }).from(s.users).orderBy(asc(s.users.displayName)),
  );
  return rows;
}

/** "All users" is resolved to everyone with an account now; later accounts are added via access updates. */
export async function resolveAccessUserIds(db: Database, access: WebsiteAccess): Promise<string[]> {
  if (access.mode === "all") return (await listPlatformUsers(db)).map((u) => u.id);
  if (access.userIds.length === 0) return [];
  const found = await db.withoutTenant((tx) => tx.select({ id: s.users.id }).from(s.users).where(inArray(s.users.id, access.userIds)));
  if (found.length !== new Set(access.userIds).size) throw new AppError(422, "unknown_user", "One or more selected users no longer exist.");
  return found.map((u) => u.id);
}

/** Sites the user is a member of whose active release carries a website theme. */
export async function listWebsites(db: Database, userId: string): Promise<DeployedWebsite[]> {
  const siteIds = await db.withUser(userId, async (tx) => [...new Set((await tx.select({ siteId: s.userSiteRoles.siteId }).from(s.userSiteRoles).where(eq(s.userSiteRoles.userId, userId))).map((r) => r.siteId))]);
  const out: DeployedWebsite[] = [];
  for (const siteId of siteIds) {
    const site = await db.withTenant({ siteId, userId }, async (tx) => {
      const [row] = await tx.select().from(s.sites).where(eq(s.sites.id, siteId));
      const active = await getActiveRelease(tx, siteId);
      if (!row || row.isSystem || !active) return null;
      const cfg = parseStoredConfig(active.configuration);
      if (!cfg.website) return null;
      const members = await tx.selectDistinct({ userId: s.userSiteRoles.userId }).from(s.userSiteRoles).where(eq(s.userSiteRoles.siteId, siteId));
      return { row, cfg, version: active.version, memberCount: members.length };
    });
    if (!site) continue;
    const theme = site.cfg.website!;
    out.push({
      id: site.row.id,
      slug: site.row.slug,
      name: site.row.name,
      path: websitePath(site.row.slug),
      themeId: theme.id,
      themeName: theme.name,
      primary: theme.palette.primary,
      shell: site.cfg.shell,
      version: site.version,
      memberCount: site.memberCount,
      createdAt: site.row.createdAt.toISOString(),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getWebsiteAccess(db: Database, ctx: { siteId: string; userId: string }): Promise<WebsiteAccessEntry[]> {
  const rows = await db.withTenant(ctx, (tx) =>
    tx
      .select({ userId: s.userSiteRoles.userId, email: s.users.email, displayName: s.users.displayName, role: s.roles.key })
      .from(s.userSiteRoles)
      .innerJoin(s.users, eq(s.users.id, s.userSiteRoles.userId))
      .innerJoin(s.roles, eq(s.roles.id, s.userSiteRoles.roleId))
      .where(eq(s.userSiteRoles.siteId, ctx.siteId))
      .orderBy(asc(s.users.displayName)),
  );
  const byUser = new Map<string, WebsiteAccessEntry>();
  for (const r of rows) {
    const e = byUser.get(r.userId) ?? { userId: r.userId, email: r.email, displayName: r.displayName, roles: [] };
    e.roles.push(r.role);
    byUser.set(r.userId, e);
  }
  return [...byUser.values()];
}

/**
 * Replaces the visitor list of a website. Administrator memberships are never touched here, so an
 * access change cannot lock the site's administrators out.
 */
export async function updateWebsiteAccess(db: Database, ctx: { siteId: string; userId: string; requestId: string }, access: WebsiteAccess): Promise<WebsiteAccessEntry[]> {
  const userIds = await resolveAccessUserIds(db, access);
  await db.withTenant({ siteId: ctx.siteId, userId: ctx.userId }, async (tx) => {
    const active = await getActiveRelease(tx, ctx.siteId);
    if (!active) throw notFound("Website not found");
    const cfg = parseStoredConfig(active.configuration);
    if (!cfg.website) throw new AppError(422, "not_a_website", "This site was not deployed from the website builder.");
    if (!cfg.roles.some((r) => r.id === access.roleId) || access.roleId === "admin") throw new AppError(422, "unknown_roles", `Choose a visitor role defined by this website (not “admin”).`);

    const roleRows = await tx.select().from(s.roles).where(inArray(s.roles.key, ["admin", access.roleId]));
    const adminRole = roleRows.find((r) => r.key === "admin");
    const visitorRole = roleRows.find((r) => r.key === access.roleId);
    if (!adminRole || !visitorRole) throw new AppError(422, "unknown_roles", "The visitor role is not defined on this platform.");

    const admins = new Set((await tx.select({ userId: s.userSiteRoles.userId }).from(s.userSiteRoles).where(and(eq(s.userSiteRoles.siteId, ctx.siteId), eq(s.userSiteRoles.roleId, adminRole.id)))).map((r) => r.userId));
    await tx.delete(s.userSiteRoles).where(and(eq(s.userSiteRoles.siteId, ctx.siteId), ne(s.userSiteRoles.roleId, adminRole.id)));
    const visitors = [...new Set(userIds)].filter((id) => !admins.has(id));
    if (visitors.length > 0) await tx.insert(s.userSiteRoles).values(visitors.map((userId) => ({ userId, siteId: ctx.siteId, roleId: visitorRole.id })));
    await recordAudit(tx, { siteId: ctx.siteId, actorId: ctx.userId, action: "website.access-updated", entityType: "site", entityId: ctx.siteId, metadata: { mode: access.mode, role: access.roleId, visitors: visitors.length }, configVersion: active.version, requestId: ctx.requestId });
  });
  return getWebsiteAccess(db, ctx);
}
