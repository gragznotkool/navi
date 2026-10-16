import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";

export const releaseSummarySchema = z.object({
  id: uuid,
  siteId: uuid,
  version: z.number().int().min(1),
  note: z.string().nullable(),
  publishedBy: uuid,
  publishedAt: isoTimestamp,
  /** Set when this release was created by rolling back to an earlier version. */
  rolledBackToVersion: z.number().int().nullable(),
  isActive: z.boolean(),
});
export type ReleaseSummary = z.infer<typeof releaseSummarySchema>;

export const releaseSchema = releaseSummarySchema.extend({ configuration: z.unknown() });
export type Release = z.infer<typeof releaseSchema>;

export const releaseDiffEntrySchema = z.object({
  path: z.string(),
  change: z.enum(["added", "removed", "changed"]),
});
export type ReleaseDiffEntry = z.infer<typeof releaseDiffEntrySchema>;

export const releaseDiffSchema = z.object({
  fromVersion: z.number().int().nullable(),
  toVersion: z.number().int(),
  entries: z.array(releaseDiffEntrySchema),
});
export type ReleaseDiff = z.infer<typeof releaseDiffSchema>;

export const publishRequestSchema = z.object({
  baseVersion: z.number().int().nullable(),
  configuration: z.unknown(),
  note: z.string().max(500).optional(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const rollbackRequestSchema = z.object({
  targetVersion: z.number().int().min(1),
  baseVersion: z.number().int().nullable(),
});
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;
