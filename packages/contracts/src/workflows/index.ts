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

export const requestTransitions: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["assigned"],
  rejected: [],
  assigned: ["fulfilled"],
  fulfilled: [],
  cancelled: [],
};

export const repairTransitions: Record<RepairStatus, readonly RepairStatus[]> = {
  received: ["diagnosing"],
  diagnosing: ["repairing", "scrapped"],
  repairing: ["testing"],
  testing: ["completed", "repairing"],
  completed: [],
  scrapped: [],
};

export const returnTransitions: Record<ReturnStatus, readonly ReturnStatus[]> = {
  initiated: ["inspected", "rejected"],
  inspected: ["restocked", "rejected"],
  restocked: [],
  rejected: [],
};
