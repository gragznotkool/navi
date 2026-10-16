import { z } from "zod";
import { uuid } from "../common/index.js";

export const siteSummarySchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  shell: z.enum(["sidebar", "topbar", "workbench"]),
  activeReleaseVersion: z.number().int().nullable(),
});
export type SiteSummary = z.infer<typeof siteSummarySchema>;
