import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";

/** Slugs that would collide with app routes or reserved sites. */
export const RESERVED_SLUGS = ["admin", "api", "login", "trust", "trust-lab", "preview", "s", "hub", "new", "sites"] as const;

export const siteSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Use 3–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit")
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "This name is reserved");

export const provisionSiteRequestSchema = z.object({
  slug: siteSlugSchema,
  name: z.string().trim().min(2, "Enter a site name").max(80),
  preset: z.string().min(1, "Choose a preset"),
  /** An existing user who will also be an administrator of the new site. */
  adminEmail: z.string().trim().email("Enter a valid email address").optional().or(z.literal("").transform(() => undefined)),
  demoStock: z.boolean().default(false),
});
export type ProvisionSiteRequest = z.infer<typeof provisionSiteRequestSchema>;

export const presetSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  modules: z.array(z.string()),
  shell: z.string(),
});
export type PresetSummary = z.infer<typeof presetSummarySchema>;

export const provisioningStatusSchema = z.enum(["running", "succeeded", "failed"]);
export type ProvisioningStatus = z.infer<typeof provisioningStatusSchema>;

export const provisioningEventSchema = z.object({
  seq: z.number().int(),
  level: z.enum(["info", "success", "error"]),
  message: z.string(),
  at: isoTimestamp,
});
export type ProvisioningEvent = z.infer<typeof provisioningEventSchema>;

export const provisioningJobSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  preset: z.string(),
  status: provisioningStatusSchema,
  error: z.string().nullable(),
  createdAt: isoTimestamp,
});
export type ProvisioningJob = z.infer<typeof provisioningJobSchema>;

export const provisioningSnapshotSchema = z.object({
  job: provisioningJobSchema,
  events: z.array(provisioningEventSchema),
});
export type ProvisioningSnapshot = z.infer<typeof provisioningSnapshotSchema>;
