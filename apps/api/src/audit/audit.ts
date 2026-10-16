import * as s from "../db/schema/index.js";
import type { Tx } from "../db/scoped.js";

export interface AuditInput {
  siteId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/** Writes inside the caller's transaction so the audit record commits or rolls back with the change. */
export async function recordAudit(tx: Tx, e: AuditInput): Promise<void> {
  await tx.insert(s.auditEvents).values({
    siteId: e.siteId,
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    metadata: e.metadata ?? null,
    requestId: e.requestId ?? null,
  });
}
