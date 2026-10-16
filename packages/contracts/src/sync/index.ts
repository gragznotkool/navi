import { z } from "zod";

/** Operations that are safe to queue on a device and replay later. Anything that moves stock is deliberately absent. */
export const SAFE_SYNC_TYPES = ["request.create", "consumption.record"] as const;
export type SafeSyncType = (typeof SAFE_SYNC_TYPES)[number];

export const syncOpSchema = z.object({
  /** Client-generated idempotency key; replaying the same key can never apply an operation twice. */
  key: z.string().min(8).max(128),
  /** Free text here so one unknown type is reported per operation instead of failing the whole batch. */
  type: z.string().min(1).max(40),
  payload: z.unknown(),
});
export type SyncOp = z.infer<typeof syncOpSchema>;

export const syncRequestSchema = z.object({ ops: z.array(syncOpSchema).min(1).max(50) });
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncResultSchema = z.object({
  key: z.string(),
  status: z.enum(["applied", "duplicate", "rejected"]),
  /** Plain-English reason, present when rejected. */
  reason: z.string().optional(),
  /** Machine-readable code, present when rejected (e.g. `blocked_offline`, `over_consumption`). */
  code: z.string().optional(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

export const syncResponseSchema = z.object({ results: z.array(syncResultSchema) });
export type SyncResponse = z.infer<typeof syncResponseSchema>;
