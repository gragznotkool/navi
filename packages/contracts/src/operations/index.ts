import { z } from "zod";
import { uuid } from "../common/index.js";
import { repairStatusSchema } from "../workflows/index.js";

// ---- returns

export const createReturnPayloadSchema = z.object({
  assignmentId: uuid,
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(1_000_000),
});
export type CreateReturnPayload = z.infer<typeof createReturnPayloadSchema>;

export const transitionReturnPayloadSchema = z.object({ to: z.enum(["inspected", "restocked", "rejected"]) });
export type TransitionReturnPayload = z.infer<typeof transitionReturnPayloadSchema>;

// ---- PCB repair

export const createRepairPayloadSchema = z.object({
  boardSerial: z
    .string()
    .trim()
    .min(1, "Enter the board serial")
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Serials use letters, digits and . _ / - only"),
});
export type CreateRepairPayload = z.infer<typeof createRepairPayloadSchema>;

export const transitionRepairPayloadSchema = z.object({ to: repairStatusSchema });
export type TransitionRepairPayload = z.infer<typeof transitionRepairPayloadSchema>;

// ---- stock adjustment

export const adjustStockPayloadSchema = z.object({
  /** Positive adds stock, negative removes it. Never zero. */
  delta: z
    .number()
    .int("Use a whole number")
    .refine((n) => n !== 0, "The change cannot be zero")
    .refine((n) => Math.abs(n) <= 1_000_000, "That change is too large"),
  reason: z.string().trim().min(3, "Say why the stock is being adjusted").max(200),
});
export type AdjustStockPayload = z.infer<typeof adjustStockPayloadSchema>;

// ---- analytics (server-computed, scoped to the caller's site and permissions)

export const analyticsSummarySchema = z.object({
  stock: z
    .object({
      totalItems: z.number().int(),
      totalOnHand: z.number().int(),
      belowReorderLevel: z.number().int(),
      outOfStock: z.number().int(),
    })
    .nullable(),
  requests: z
    .object({
      byStatus: z.record(z.string(), z.number().int()),
      /** Submitted requests older than the approval deadline, when the site sets one. */
      overdue: z.number().int().nullable(),
    })
    .nullable(),
  /** Stock movements per day for the last 14 days (units in / units out). */
  movements: z.array(z.object({ day: z.string(), unitsIn: z.number().int(), unitsOut: z.number().int() })).nullable(),
  returns: z.object({ byStatus: z.record(z.string(), z.number().int()) }).nullable(),
  repairs: z.object({ byStatus: z.record(z.string(), z.number().int()) }).nullable(),
  source: z.literal("database"),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

// ---- site members (user management)

export const siteMemberSchema = z.object({
  userId: uuid,
  email: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
});
export type SiteMember = z.infer<typeof siteMemberSchema>;

export const addMemberPayloadSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.string().min(1).max(40),
});
export type AddMemberPayload = z.infer<typeof addMemberPayloadSchema>;

export const setMemberRolesPayloadSchema = z.object({ roles: z.array(z.string().min(1).max(40)).max(10) });
export type SetMemberRolesPayload = z.infer<typeof setMemberRolesPayloadSchema>;
