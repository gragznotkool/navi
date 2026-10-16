import { z } from "zod";

export const workflowStatusSchema = z.enum([
  "draft",
  "submitted",
  "approved",
  "rejected",
  "assigned",
  "fulfilled",
  "cancelled",
]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const repairStatusSchema = z.enum([
  "received",
  "diagnosing",
  "repairing",
  "testing",
  "completed",
  "scrapped",
]);
export type RepairStatus = z.infer<typeof repairStatusSchema>;

export const returnStatusSchema = z.enum(["initiated", "inspected", "restocked", "rejected"]);
export type ReturnStatus = z.infer<typeof returnStatusSchema>;
