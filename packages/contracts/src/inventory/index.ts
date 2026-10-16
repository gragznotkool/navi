import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";
import {
  repairStatusSchema,
  returnStatusSchema,
  workflowStatusSchema,
} from "../workflows/index.js";

export const stockItemSchema = z.object({
  id: uuid,
  siteId: uuid,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  onHand: z.number().int().min(0),
  reorderLevel: z.number().int().min(0),
  updatedAt: isoTimestamp,
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const requestRecordSchema = z.object({
  id: uuid,
  siteId: uuid,
  itemId: uuid,
  quantity: z.number().int().min(1),
  status: workflowStatusSchema,
  requestedBy: uuid,
  /** Configuration release version under which this request was created. */
  releaseVersion: z.number().int(),
  createdAt: isoTimestamp,
});
export type RequestRecord = z.infer<typeof requestRecordSchema>;

export const approvedRequestSchema = requestRecordSchema.extend({
  status: z.literal("approved"),
  approvedBy: uuid,
  approvedAt: isoTimestamp,
});
export type ApprovedRequest = z.infer<typeof approvedRequestSchema>;

export const assignmentSchema = z.object({
  id: uuid,
  siteId: uuid,
  requestId: uuid,
  itemId: uuid,
  quantity: z.number().int().min(1),
  assignedBy: uuid,
  createdAt: isoTimestamp,
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const consumptionRecordSchema = z.object({
  id: uuid,
  siteId: uuid,
  assignmentId: uuid,
  quantity: z.number().int().min(1),
  recordedBy: uuid,
  createdAt: isoTimestamp,
});
export type ConsumptionRecord = z.infer<typeof consumptionRecordSchema>;

export const returnRecordSchema = z.object({
  id: uuid,
  siteId: uuid,
  assignmentId: uuid,
  quantity: z.number().int().min(1),
  status: returnStatusSchema,
  createdAt: isoTimestamp,
});
export type ReturnRecord = z.infer<typeof returnRecordSchema>;

export const repairRecordSchema = z.object({
  id: uuid,
  siteId: uuid,
  boardSerial: z.string(),
  status: repairStatusSchema,
  createdAt: isoTimestamp,
});
export type RepairRecord = z.infer<typeof repairRecordSchema>;

// ---- request payloads (shared by API validation and frontend forms) ----

export const createRequestPayloadSchema = z.object({
  itemId: uuid,
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(1_000_000),
  note: z.string().max(500).optional(),
});
export type CreateRequestPayload = z.infer<typeof createRequestPayloadSchema>;

export const decideRequestPayloadSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(500).optional(),
});
export type DecideRequestPayload = z.infer<typeof decideRequestPayloadSchema>;

export const createAssignmentPayloadSchema = z.object({ requestId: uuid });
export type CreateAssignmentPayload = z.infer<typeof createAssignmentPayloadSchema>;

export const recordConsumptionPayloadSchema = z.object({
  assignmentId: uuid,
  quantity: z.number().int().min(1).max(1_000_000),
});
export type RecordConsumptionPayload = z.infer<typeof recordConsumptionPayloadSchema>;

// ---- Excel reports (F9) ----

export const MASKED_CELL = "*** CONFIDENTIAL ***";
export const REPORT_MAX_BYTES = 5 * 1024 * 1024;
export const REPORT_MAX_ROWS = 5000;

export const reportColumnSchema = z.object({
  key: z.string(),
  header: z.string(),
  required: z.boolean(),
  masked: z.boolean(),
  /** Export-only columns (calculated) are ignored on import. */
  importable: z.boolean(),
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

/** What the signed-in user may do with a report, with their role-specific masking already applied. */
export const reportAccessSchema = z.object({
  key: z.string(),
  title: z.string(),
  canExport: z.boolean(),
  canImport: z.boolean(),
  columns: z.array(reportColumnSchema),
});
export type ReportAccess = z.infer<typeof reportAccessSchema>;

export const importRowErrorSchema = z.object({ row: z.number().int(), column: z.string(), message: z.string() });
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importResultSchema = z.object({
  fileName: z.string(),
  rowCount: z.number().int(),
  dryRun: z.boolean(),
  written: z.number().int(),
});
export type ImportResult = z.infer<typeof importResultSchema>;
