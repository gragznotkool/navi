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

// ---- live Trust Console proofs ----

export const proofStatusSchema = z.enum(["not-run", "pass", "fail", "error"]);
export type ProofStatus = z.infer<typeof proofStatusSchema>;

/** One dot in the console: a single check, optionally scoped to one table. */
export const proofCellSchema = z.object({
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});
export type ProofCell = z.infer<typeof proofCellSchema>;

export const proofResultSchema = z.object({
  proofId: z.string(),
  status: proofStatusSchema,
  ranAt: z.string().datetime({ offset: true }).nullable(),
  durationMs: z.number().nullable(),
  cells: z.array(proofCellSchema),
  /** Raw numbers behind the verdict (counts, timings). */
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  error: z.string().nullable(),
});
export type ProofResult = z.infer<typeof proofResultSchema>;

export const proofDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** Whether running it writes (committed) rows into the reserved lab site. */
  writesToLab: z.boolean(),
});
export type ProofDefinition = z.infer<typeof proofDefinitionSchema>;

export const proofListSchema = z.object({
  environment: z.object({
    nodeEnv: z.string(),
    database: z.string(),
    databaseRole: z.string(),
    labSite: z.string(),
    note: z.string(),
  }),
  proofs: z.array(z.object({ definition: proofDefinitionSchema, last: proofResultSchema })),
});
export type ProofList = z.infer<typeof proofListSchema>;

