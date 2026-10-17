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
  /** Values of configured, visible fields. */
  extras: z.record(z.string(), z.unknown()).default({}),
  updatedAt: isoTimestamp,
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const requestLineSchema = z.object({
  id: uuid,
  itemId: uuid,
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int().min(1),
  /** Values of configurable fields (hidden fields are stripped before reaching the client). */
  extras: z.record(z.string(), z.unknown()).default({}),
});
export type RequestLine = z.infer<typeof requestLineSchema>;

export const requestRecordSchema = z.object({
  id: uuid,
  siteId: uuid,
  lines: z.array(requestLineSchema).default([]),
  status: workflowStatusSchema,
  requestedBy: uuid,
  /** Configuration release version under which this request was created. */
  releaseVersion: z.number().int(),
  createdAt: isoTimestamp,
  /** When the status last changed (drives Aging SLA). */
  statusChangedAt: isoTimestamp.optional(),
  /** Server-computed seconds since the last status change. */
  ageSeconds: z.number().int().min(0).default(0),
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
  /** Total units across all lines of the request. */
  quantity: z.number().int().min(1),
  /** Release version in force when the stock was assigned. */
  configVersion: z.number().int().nullable().default(null),
  lines: z.array(requestLineSchema.omit({ extras: true })).default([]),
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
  technicianId: uuid.nullable().default(null),
  createdAt: isoTimestamp,
});
export type RepairRecord = z.infer<typeof repairRecordSchema>;

// ---- request payloads (shared by API validation and frontend forms) ----

export const createRequestLinePayloadSchema = z.object({
  itemId: uuid,
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(1_000_000),
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type CreateRequestLinePayload = z.infer<typeof createRequestLinePayloadSchema>;

export const createRequestPayloadSchema = z.object({
  lines: z
    .array(createRequestLinePayloadSchema)
    .min(1, "Add at least one item")
    .max(50)
    .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, "Each item can appear only once"),
  note: z.string().max(500).optional(),
});
export type CreateRequestPayload = z.infer<typeof createRequestPayloadSchema>;

export const updateItemFieldsPayloadSchema = z.object({
  /** Field values to set. `null` clears a value. */
  extras: z.record(z.string(), z.unknown()),
});
export type UpdateItemFieldsPayload = z.infer<typeof updateItemFieldsPayloadSchema>;

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

export const updateReturnStatusPayloadSchema = z.object({
  status: returnStatusSchema,
});
export type UpdateReturnStatusPayload = z.infer<typeof updateReturnStatusPayloadSchema>;

export const updateRepairStatusPayloadSchema = z.object({
  status: repairStatusSchema,
});
export type UpdateRepairStatusPayload = z.infer<typeof updateRepairStatusPayloadSchema>;

