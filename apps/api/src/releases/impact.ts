import { and, eq, inArray, sql } from "drizzle-orm";
import type { ImpactField, ReleaseImpact, SiteConfiguration } from "@opshub/contracts";
import * as s from "../db/schema/index.js";
import type { Tx } from "../db/scoped.js";
import { getModuleDefinition } from "../modules/registry.js";
import { describeChanges } from "./plain.js";

const moduleName = (type: string) => getModuleDefinition(type as never)?.displayName ?? type;

/** Number of rows (of the field's entity) in this site that hold a value for `key`. */
async function rowsWithData(tx: Tx, siteId: string, entity: string, key: string): Promise<number> {
  const table = entity === "inventory_item" ? s.inventoryItems : s.requestLines;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(eq(table.siteId, siteId), sql`jsonb_exists(${table.extras}, ${key})`));
  return row?.n ?? 0;
}

export interface ImpactAnalysis {
  impact: ReleaseImpact;
  sentences: string[];
}

/**
 * What would publishing `candidate` over `active` do? Uses real row counts for fields whose values
 * would stop being shown. `destructive` means a human must explicitly confirm before publishing.
 */
export async function analyzeImpact(tx: Tx, siteId: string, active: SiteConfiguration, candidate: SiteConfiguration): Promise<ImpactAnalysis> {
  const activeNodes = new Map(active.modules.nodes.map((n) => [n.id, n]));
  const candNodes = new Map(candidate.modules.nodes.map((n) => [n.id, n]));
  const modulesAdded = [...candNodes.values()].filter((n) => !activeNodes.has(n.id)).map((n) => moduleName(n.moduleType));
  const modulesRemoved = [...activeNodes.values()].filter((n) => !candNodes.has(n.id)).map((n) => moduleName(n.moduleType));

  const key = (f: { entity: string; key: string }) => `${f.entity}.${f.key}`;
  const candFields = new Map(candidate.fields.map((f) => [key(f), f]));
  const fieldsHidden: ImpactField[] = [];
  const fieldsRemoved: ImpactField[] = [];
  const counts = new Map<string, number>();
  for (const f of active.fields) {
    const next = candFields.get(key(f));
    const hiding = next !== undefined && !f.hidden && next.hidden;
    if (next === undefined || hiding) {
      const n = await rowsWithData(tx, siteId, f.entity, f.key);
      counts.set(key(f), n);
      (next ? fieldsHidden : fieldsRemoved).push({ entity: f.entity, key: f.key, label: f.label, rowsWithData: n });
    }
  }

  const candRoles = new Map(candidate.roles.map((r) => [r.id, r]));
  const roleChanges: ReleaseImpact["roleChanges"] = [];
  for (const r of active.roles) {
    const next = candRoles.get(r.id);
    const added = next ? next.permissions.filter((p) => !r.permissions.includes(p)).sort() : [];
    const removed = (next ? r.permissions.filter((p) => !next.permissions.includes(p)) : r.permissions).sort();
    if (added.length || removed.length) roleChanges.push({ role: r.name, added, removed });
  }

  const open = await tx
    .select({ version: s.requests.releaseVersion, count: sql<number>`count(*)::int` })
    .from(s.requests)
    .where(and(eq(s.requests.siteId, siteId), inArray(s.requests.status, ["submitted", "approved"])))
    .groupBy(s.requests.releaseVersion)
    .orderBy(s.requests.releaseVersion);

  const reasons: string[] = [];
  if (modulesRemoved.length) reasons.push(`Removes ${modulesRemoved.length === 1 ? "a module" : "modules"}: ${modulesRemoved.join(", ")}.`);
  for (const f of fieldsRemoved) {
    reasons.push(`Removes the “${f.label}” field${f.rowsWithData ? ` (${f.rowsWithData} saved value${f.rowsWithData === 1 ? "" : "s"} will no longer be shown)` : ""}.`);
  }
  for (const f of fieldsHidden) {
    if (f.rowsWithData > 0) reasons.push(`Hides the “${f.label}” field, which ${f.rowsWithData} row${f.rowsWithData === 1 ? " has" : "s have"} data for (the values are kept).`);
  }
  for (const c of roleChanges) {
    if (c.removed.length) reasons.push(`The “${c.role}” role loses ${c.removed.length} permission${c.removed.length === 1 ? "" : "s"}.`);
  }

  const impact: ReleaseImpact = {
    modulesAdded,
    modulesRemoved,
    fieldsHidden,
    fieldsRemoved,
    roleChanges,
    openRequestsByVersion: open.map((o) => ({ version: o.version, count: o.count })),
    destructive: reasons.length > 0,
    destructiveReasons: reasons,
  };
  const sentences = describeChanges(active, candidate, counts);
  const stillOpen = impact.openRequestsByVersion.reduce((n, o) => n + o.count, 0);
  if (stillOpen > 0) sentences.push(`${stillOpen} open request${stillOpen === 1 ? "" : "s"} keep following the rules they were created under.`);
  return { impact, sentences };
}
