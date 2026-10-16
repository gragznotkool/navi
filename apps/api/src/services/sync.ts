import { createRequestPayloadSchema, recordConsumptionPayloadSchema, type SyncOp, type SyncResult } from "@opshub/contracts";
import type { Database } from "../db/scoped.js";
import { AppError } from "../utils/errors.js";
import * as ops from "./operations.js";

/** Stock-changing and other operations that must happen online, with the reason shown to the user. */
const BLOCKED: Record<string, string> = {
  "assignment.create": "Assigning stock changes quantities, so it needs a live connection.",
  "inventory.import": "Importing stock changes quantities, so it needs a live connection.",
  "inventory.adjust": "Adjusting stock needs a live connection.",
};

const reject = (key: string, code: string, reason: string): SyncResult => ({ key, status: "rejected", code, reason });

/**
 * Applies queued offline operations one by one, each in its own transaction under its own idempotency key:
 * replaying a key is reported as `duplicate` and changes nothing; a rejected operation never blocks the others.
 * Only operations that cannot corrupt stock are accepted; anything else is rejected with an explanation.
 */
export async function applySync(db: Database, a: ops.Actor, permissions: ReadonlySet<string>, batch: SyncOp[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const seen = new Set<string>();
  for (const op of batch) {
    if (seen.has(op.key)) {
      results.push({ key: op.key, status: "duplicate" }); // the same key twice in one batch applies once
      continue;
    }
    seen.add(op.key);
    results.push(await applyOne(db, a, permissions, op));
  }
  return results;
}

async function applyOne(db: Database, a: ops.Actor, permissions: ReadonlySet<string>, op: SyncOp): Promise<SyncResult> {
  const blocked = Object.hasOwn(BLOCKED, op.type) ? BLOCKED[op.type] : undefined;
  if (blocked) return reject(op.key, "blocked_offline", blocked);

  try {
    if (op.type === "request.create") {
      if (!permissions.has("request:create")) return reject(op.key, "forbidden", "You no longer have permission to create requests here.");
      const parsed = createRequestPayloadSchema.safeParse(op.payload);
      if (!parsed.success) return reject(op.key, "invalid", parsed.error.issues[0]?.message ?? "The saved request is not valid.");
      const { replayed } = await db.withTenant({ siteId: a.siteId, userId: a.userId }, (tx) => ops.idempotent(tx, a, op.key, "sync.request.create", parsed.data, () => ops.createRequestIn(tx, a, parsed.data)));
      return { key: op.key, status: replayed ? "duplicate" : "applied" };
    }
    if (op.type === "consumption.record") {
      if (!permissions.has("consumption:record")) return reject(op.key, "forbidden", "You no longer have permission to record consumption here.");
      const parsed = recordConsumptionPayloadSchema.safeParse(op.payload);
      if (!parsed.success) return reject(op.key, "invalid", parsed.error.issues[0]?.message ?? "The saved entry is not valid.");
      const { assignmentId, quantity } = parsed.data;
      const { replayed } = await db.withTenant({ siteId: a.siteId, userId: a.userId }, (tx) => ops.idempotent(tx, a, op.key, "sync.consumption.record", parsed.data, () => ops.recordConsumptionIn(tx, a, assignmentId, quantity)));
      return { key: op.key, status: replayed ? "duplicate" : "applied" };
    }
    return reject(op.key, "unsupported", "This kind of change cannot be saved offline.");
  } catch (e) {
    // Business rules (not found, over-consumption, a key reused for different content, …) are the user's to see.
    if (e instanceof AppError && e.status < 500) return reject(op.key, e.code, e.message);
    throw e; // unexpected: fail the whole request so the device keeps its queue and retries
  }
}
