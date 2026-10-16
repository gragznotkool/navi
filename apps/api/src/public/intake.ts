import { and, eq, inArray, sql } from "drizzle-orm";
import type { PublicRequest } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import type { Database } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { validateExtras } from "../fields/runtime.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
import { AppError, notFound } from "../utils/errors.js";

/** The system account that owns anonymous requests (created by migration 0005; nobody can sign in as it). */
export const PUBLIC_INTAKE_USER_ID = "00000000-0000-4000-8000-0000000000bb";

/**
 * Accepts one anonymous request. It exists only for a site whose ACTIVE release turns on `publicIntake` on the Request
 * module; for every other address (unknown, system, or not enabled) the answer is the same 404, so nothing can be probed.
 * The request is stored as `submitted` and goes through the normal approval; nothing is returned about it.
 */
export async function submitPublicRequest(db: Database, slug: string, input: PublicRequest, requestId: string): Promise<void> {
  const siteId = await db.withoutTenant(async (tx) => {
    // Scoped to this transaction: the database policy then reveals exactly this one site row.
    await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`);
    const [row] = await tx.select({ id: s.sites.id }).from(s.sites).where(eq(s.sites.slug, slug));
    return row?.id ?? null;
  });
  if (!siteId) throw notFound("Not found");

  await db.withTenant({ siteId, userId: PUBLIC_INTAKE_USER_ID }, async (tx) => {
    const active = await getActiveRelease(tx, siteId);
    if (!active) throw notFound("Not found");
    const cfg = parseStoredConfig(active.configuration);
    const enabled = cfg.modules.nodes.some((n) => n.moduleType === "request" && n.config["publicIntake"] === true);
    if (!enabled) throw notFound("Not found");

    const skus = input.lines.map((l) => l.sku);
    if (new Set(skus).size !== skus.length) throw new AppError(422, "invalid_request", "List each item once.");
    const items = await tx
      .select({ id: s.inventoryItems.id, sku: s.inventoryItems.sku })
      .from(s.inventoryItems)
      .where(and(eq(s.inventoryItems.siteId, siteId), inArray(s.inventoryItems.sku, skus)));
    const bySku = new Map(items.map((i) => [i.sku, i.id]));
    if (skus.some((k) => !bySku.has(k))) throw new AppError(422, "invalid_request", "One of the items is not available.");

    // Required request-line fields cannot be collected anonymously, so such a site cannot accept public requests.
    try {
      validateExtras(cfg, "request_line", {}, { requireAll: true });
    } catch {
      throw new AppError(422, "invalid_request", "This form is not available.");
    }

    const [row] = await tx
      .insert(s.requests)
      .values({ siteId, status: "submitted", requestedBy: PUBLIC_INTAKE_USER_ID, releaseVersion: active.version, note: input.note ? `Public request: ${input.note}` : "Public request" })
      .returning({ id: s.requests.id });
    await tx.insert(s.requestLines).values(input.lines.map((l) => ({ siteId, requestId: row!.id, itemId: bySku.get(l.sku)!, quantity: l.quantity, extras: {} })));
    await recordAudit(tx, { siteId, actorId: PUBLIC_INTAKE_USER_ID, action: "request.submitted-public", entityType: "request", entityId: row!.id, configVersion: active.version, requestId, metadata: { lines: input.lines.length } });
  });
}
