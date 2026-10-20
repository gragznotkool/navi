import { z } from "zod";
import { siteConfigurationSchema } from "../config/index.js";

export const proposalStatusSchema = z.enum([
  "draft",
  "generated",
  "validated",
  "pending_approval",
  "approved",
  "rejected",
  "published",
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalChangeItemSchema = z.object({
  type: z.enum(["module", "workflow", "role", "field", "setting"]),
  target: z.string(),
  operation: z.enum(["add", "modify", "remove"]),
  description: z.string(),
  severity: z.enum(["normal", "security_sensitive"]).default("normal"),
});
export type ProposalChangeItem = z.infer<typeof proposalChangeItemSchema>;

export const proposalDiffSummarySchema = z.object({
  modulesAdded: z.array(z.string()),
  modulesRemoved: z.array(z.string()),
  fieldsAdded: z.array(z.string()),
  fieldsRemoved: z.array(z.string()),
  permissionsAdded: z.array(z.string()),
  rolesAffected: z.array(z.string()),
  totalChanges: z.number(),
  securitySensitive: z.boolean(),
});
export type ProposalDiffSummary = z.infer<typeof proposalDiffSummarySchema>;

export const configurationProposalSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  siteSlug: z.string(),
  siteName: z.string(),
  title: z.string(),
  summary: z.string(),
  prompt: z.string(),
  status: proposalStatusSchema,
  baseVersion: z.number().nullable(),
  proposedConfiguration: z.lazy(() => siteConfigurationSchema),
  configurationHash: z.string(),
  affectedModules: z.array(z.string()),
  changes: z.array(proposalChangeItemSchema),
  diffSummary: proposalDiffSummarySchema,
  validationResult: z.object({
    valid: z.boolean(),
    errors: z.array(z.object({ stage: z.string(), code: z.string(), message: z.string(), path: z.string().optional() })),
    warnings: z.array(z.object({ stage: z.string(), code: z.string(), message: z.string(), path: z.string().optional() })),
  }),
  aiExplanation: z.object({
    whatChanges: z.string(),
    whyItAddressesPrompt: z.string(),
    affectedUsers: z.string(),
    workflowImpact: z.string(),
    securityImplications: z.string(),
    assumptions: z.array(z.string()),
    unresolvedQuestions: z.array(z.string()),
  }),
  createdBy: z.string().uuid(),
  createdByName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedBy: z.string().uuid().nullable().optional(),
  approvedByName: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  publishedReleaseVersion: z.number().nullable().optional(),
});
export type ConfigurationProposal = z.infer<typeof configurationProposalSchema>;

export const generateProposalRequestSchema = z.object({
  siteId: z.string().uuid(),
  prompt: z.string().min(3, "Prompt must be at least 3 characters").max(2000, "Prompt is too long"),
});
export type GenerateProposalRequest = z.infer<typeof generateProposalRequestSchema>;

export const updateProposalRequestSchema = z.object({
  title: z.string().optional(),
  proposedConfiguration: z.lazy(() => siteConfigurationSchema).optional(),
  refinementPrompt: z.string().optional(),
});
export type UpdateProposalRequest = z.infer<typeof updateProposalRequestSchema>;

export const approveProposalRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().max(500).optional(),
});
export type ApproveProposalRequest = z.infer<typeof approveProposalRequestSchema>;

export const publishProposalRequestSchema = z.object({
  confirmDestructive: z.boolean().optional(),
});
export type PublishProposalRequest = z.infer<typeof publishProposalRequestSchema>;
