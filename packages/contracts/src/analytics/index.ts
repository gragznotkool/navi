import { z } from "zod";

export const stockSummarySchema = z.object({
  totalItems: z.number().int(),
  belowReorderLevel: z.number().int(),
  source: z.literal("database"),
});
export type StockSummary = z.infer<typeof stockSummarySchema>;

export const trustCheckStatusSchema = z.enum(["not-run", "passed", "failed"]);
export type TrustCheckStatus = z.infer<typeof trustCheckStatusSchema>;

export const trustCheckResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: trustCheckStatusSchema,
  environment: z.enum(["test", "production-monitoring"]),
  detail: z.string().optional(),
  ranAt: z.string().datetime({ offset: true }).optional(),
});
export type TrustCheckResult = z.infer<typeof trustCheckResultSchema>;
