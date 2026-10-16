import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";

export const releaseSummarySchema = z.object({
  id: uuid,
  siteId: uuid,
  version: z.number().int().min(1),
  note: z.string().nullable(),
  publishedBy: uuid,
  /** Display name of the publisher, when known. */
  publishedByName: z.string().nullable().optional(),
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
  /** Must be true when the impact preview reports the change as destructive. */
  confirmDestructive: z.boolean().optional(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const rollbackRequestSchema = z.object({
  targetVersion: z.number().int().min(1),
  baseVersion: z.number().int().nullable(),
  confirmDestructive: z.boolean().optional(),
});
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;

// ---- impact analysis & plain-English change summaries (Track B) ----

export const impactFieldSchema = z.object({
  entity: z.string(),
  key: z.string(),
  label: z.string(),
  /** How many existing rows hold a value for this field. Those values are kept in the database. */
  rowsWithData: z.number().int().min(0),
});
export type ImpactField = z.infer<typeof impactFieldSchema>;

export const releaseImpactSchema = z.object({
  modulesAdded: z.array(z.string()),
  modulesRemoved: z.array(z.string()),
  fieldsHidden: z.array(impactFieldSchema),
  fieldsRemoved: z.array(impactFieldSchema),
  roleChanges: z.array(z.object({ role: z.string(), added: z.array(z.string()), removed: z.array(z.string()) })),
  /** Requests still in flight (submitted/approved), grouped by the release version they were created under. */
  openRequestsByVersion: z.array(z.object({ version: z.number().int(), count: z.number().int() })),
  destructive: z.boolean(),
  destructiveReasons: z.array(z.string()),
});
export type ReleaseImpact = z.infer<typeof releaseImpactSchema>;

/** Preview request: either a candidate configuration or a target version (rollback). */
export const impactRequestSchema = z
  .object({
    baseVersion: z.number().int().nullable(),
    configuration: z.unknown().optional(),
    targetVersion: z.number().int().min(1).optional(),
  })
  .refine((v) => v.configuration !== undefined || v.targetVersion !== undefined, "Provide a configuration or a targetVersion");
export type ImpactRequest = z.infer<typeof impactRequestSchema>;

export const impactReportSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  /** Plain-English list of what will change, one sentence each. */
  sentences: z.array(z.string()),
  impact: releaseImpactSchema.nullable(),
});
export type ImpactReport = z.infer<typeof impactReportSchema>;
