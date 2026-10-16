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

export const hubSiteOverviewSchema = z.object({
  siteId: z.string(),
  name: z.string(),
  slug: z.string(),
  inventoryItems: z.number().int(),
  stockUnits: z.number(),
  pendingRequests: z.number().int(),
  pendingApprovals: z.number().int(),
  outstandingAssignments: z.number().int(),
});
export type HubSiteOverview = z.infer<typeof hubSiteOverviewSchema>;

export const hubOverviewTotalsSchema = z.object({
  sites: z.number().int(),
  inventoryItems: z.number().int(),
  stockUnits: z.number(),
  pendingRequests: z.number().int(),
  pendingApprovals: z.number().int(),
  outstandingAssignments: z.number().int(),
});
export type HubOverviewTotals = z.infer<typeof hubOverviewTotalsSchema>;

export const hubOverviewResponseSchema = z.object({
  totals: hubOverviewTotalsSchema,
  sites: z.array(hubSiteOverviewSchema),
});
export type HubOverviewResponse = z.infer<typeof hubOverviewResponseSchema>;

