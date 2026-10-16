import { z } from "zod";
import { moduleTypeSchema } from "../modules/index.js";
import { permissionSchema } from "../auth/index.js";
import { impactReportSchema } from "../releases/index.js";
import { configurationValidationResultSchema } from "../config/index.js";

/** Spoken languages the mic supports (Web Speech API codes). */
export const speechLangSchema = z.enum(["en-IN", "hi-IN", "mr-IN"]);
export type SpeechLang = z.infer<typeof speechLangSchema>;

/**
 * The only edits "Bolo & Build" can ask for. Everything else is refused. Each op is a small, closed shape;
 * unknown keys are rejected so a model cannot smuggle extra instructions through.
 */
export const patchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add-module"), moduleType: moduleTypeSchema }).strict(),
  z.object({ op: z.literal("remove-module"), moduleType: moduleTypeSchema }).strict(),
  z.object({ op: z.literal("rename-site"), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ op: z.literal("grant-permission"), role: z.string().min(1).max(40), permission: permissionSchema }).strict(),
]);
export type PatchOp = z.infer<typeof patchOpSchema>;

/** What a provider must return. Parsed with this schema before anything is applied. */
export const configPatchSchema = z
  .object({
    ops: z.array(patchOpSchema).min(1).max(6),
    /** The model's own one-line description; shown to the user but never trusted for decisions. */
    summary: z.string().max(300).optional(),
  })
  .strict();
export type ConfigPatch = z.infer<typeof configPatchSchema>;

export const aiPatchRequestSchema = z.object({
  utterance: z.string().trim().min(2, "Say or type what you want to change").max(500),
  lang: speechLangSchema.default("en-IN"),
  /** The builder's current draft, if any; otherwise the active release is used. */
  configuration: z.unknown().optional(),
});
export type AiPatchRequest = z.infer<typeof aiPatchRequestSchema>;

export const aiPatchResponseSchema = z.object({
  /** `model` = produced by an AI provider; `fallback` = deterministic canned patch (no key, offline or provider error). */
  source: z.enum(["model", "fallback"]),
  provider: z.string(),
  /** Why the fallback was used, when it was. */
  fallbackReason: z.string().nullable(),
  patch: configPatchSchema.nullable(),
  /** The patch applied to a COPY of the configuration. Nothing is saved or published. */
  configuration: z.unknown().nullable(),
  validation: configurationValidationResultSchema.nullable(),
  /** Plain-English description of what the patch would do. */
  sentences: z.array(z.string()),
  impact: impactReportSchema.nullable(),
  /** Ops that were understood but could not be applied, each with a reason. */
  skipped: z.array(z.object({ op: z.string(), reason: z.string() })),
  /** A message when no patch could be produced at all. */
  message: z.string().nullable(),
  published: z.literal(false),
});
export type AiPatchResponse = z.infer<typeof aiPatchResponseSchema>;
