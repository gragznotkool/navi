import { configPatchSchema, siteConfigurationSchema, type AiPatchRequest, type AiPatchResponse, type ConfigPatch, type ImpactReport } from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import { compileConfiguration } from "../compiler/compile.js";
import type { Database } from "../db/scoped.js";
import { analyzeImpact } from "../releases/impact.js";
import { describeChanges } from "../releases/plain.js";
import { getActiveRelease, parseStoredConfig } from "../repositories/releases.js";
import { AppError, badRequest } from "../utils/errors.js";
import { applyPatch } from "./apply.js";
import { cannedPatch } from "./fallback.js";
import type { PatchProvider } from "./providers.js";

export interface AiDeps {
  db: Database;
  /** `null` when no key is configured. */
  provider: PatchProvider | null;
  log?: (msg: string, meta: Record<string, unknown>) => void;
}

interface Actor {
  siteId: string;
  userId: string;
  requestId: string;
}

/**
 * Audit text is kept to characters every database encoding can store. A cluster created with a legacy encoding
 * (e.g. WIN1252 on some Windows installs) rejects Devanagari text with an error, and an audit note must never
 * be the reason a request fails. The original words are shown in the UI; the audit keeps a Latin-1-safe copy.
 */
export const auditSafe = (text: string, max = 200): string => [...text.slice(0, max)].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : "?")).join("");

const empty = (over: Partial<AiPatchResponse>): AiPatchResponse => ({
  source: "fallback",
  provider: "built-in demo phrases",
  fallbackReason: null,
  patch: null,
  configuration: null,
  validation: null,
  sentences: [],
  impact: null,
  skipped: [],
  message: null,
  published: false,
  ...over,
});

/**
 * "Bolo & Build": turns an utterance into a PROPOSED configuration change. Nothing here saves or publishes:
 * the caller gets a patch, the patched copy, the compiler's verdict and a plain-English impact, and a human
 * decides in the builder. Provider output is untrusted and is parsed with a closed schema before use.
 */
export async function proposePatch(deps: AiDeps, actor: Actor, req: AiPatchRequest): Promise<AiPatchResponse> {
  const { db, provider } = deps;
  const log = deps.log ?? (() => undefined);

  // 1. Baseline: the builder's draft when supplied, otherwise the active release.
  const active = await db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
    const release = await getActiveRelease(tx, actor.siteId);
    if (!release) throw new AppError(404, "no_active_release", "Site has no active configuration release");
    return parseStoredConfig(release.configuration);
  });
  let baseline = active;
  if (req.configuration !== undefined) {
    const parsed = siteConfigurationSchema.safeParse(req.configuration);
    if (!parsed.success) throw badRequest("The draft you sent is not a valid configuration. Reload the builder and try again.");
    if (parsed.data.siteId !== actor.siteId) throw badRequest("The draft belongs to a different site.");
    baseline = parsed.data;
  }

  // 2. Ask the provider (outside any database transaction: it can take seconds). Anything unusable falls back.
  let patch: ConfigPatch | null = null;
  let source: AiPatchResponse["source"] = "model";
  let providerName = provider?.name ?? "built-in demo phrases";
  let fallbackReason: string | null = null;
  let modelUnderstoodNothing = false;

  if (!provider) {
    source = "fallback";
    fallbackReason = "No AI key is configured on the server.";
  } else {
    try {
      const raw = await provider.propose({
        utterance: req.utterance,
        lang: req.lang,
        context: { siteName: baseline.name, modules: baseline.modules.nodes.map((n) => n.moduleType), roles: baseline.roles.map((r) => ({ id: r.id, name: r.name })) },
      });
      const rawOps = raw && typeof raw === "object" ? (raw as { ops?: unknown }).ops : undefined;
      if (Array.isArray(rawOps) && rawOps.length === 0) {
        modelUnderstoodNothing = true;
      } else {
        const parsed = configPatchSchema.safeParse(raw);
        if (parsed.success) patch = parsed.data;
        else {
          source = "fallback";
          fallbackReason = "The AI returned something that could not be used, so it was ignored.";
          log("ai.invalid-output", { issues: parsed.error.issues.length });
        }
      }
    } catch (e) {
      source = "fallback";
      fallbackReason = "The AI service could not be reached in time.";
      log("ai.provider-error", { provider: provider.name, error: e instanceof Error ? e.message : "unknown" });
    }
  }

  if (!patch && !modelUnderstoodNothing) {
    patch = cannedPatch(req.utterance);
    source = "fallback";
    providerName = "built-in demo phrases";
  }

  const audit = async (outcome: string, extra: Record<string, unknown> = {}) =>
    db.withTenant({ siteId: actor.siteId, userId: actor.userId }, (tx) =>
      recordAudit(tx, {
        siteId: actor.siteId,
        actorId: actor.userId,
        action: "ai.patch-proposed",
        entityType: "configuration",
        requestId: actor.requestId,
        metadata: { source, provider: providerName, lang: req.lang, outcome, utterance: auditSafe(req.utterance), ...extra },
      }),
    );

  if (!patch) {
    await audit("no-match");
    return empty({
      source,
      provider: providerName,
      fallbackReason,
      message: "I could not turn that into a change. Try something like “add return management”, “remove returns” or “rename the site to Pune Depot”.",
    });
  }

  // 3. Apply to a copy, then run the same compiler the builder and publish use.
  const applied = applyPatch(baseline, patch);
  const { result, compiled } = compileConfiguration(applied.configuration);
  const sentences = describeChanges(baseline, applied.configuration);

  let impact: ImpactReport | null = null;
  await db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
    if (compiled) {
      const analysis = await analyzeImpact(tx, actor.siteId, active, compiled);
      impact = { valid: true, errors: [], sentences: analysis.sentences, impact: analysis.impact };
    } else {
      impact = { valid: false, errors: result.errors.map((e) => `${e.code}: ${e.message}`), sentences, impact: null };
    }
    await recordAudit(tx, {
      siteId: actor.siteId,
      actorId: actor.userId,
      action: "ai.patch-proposed",
      entityType: "configuration",
      requestId: actor.requestId,
      metadata: { source, provider: providerName, lang: req.lang, outcome: result.valid ? "valid" : "invalid", ops: applied.applied.length, skipped: applied.skipped.length, utterance: auditSafe(req.utterance) },
    });
  });

  return empty({
    source,
    provider: providerName,
    fallbackReason,
    patch,
    configuration: applied.configuration,
    validation: result,
    sentences,
    impact,
    skipped: applied.skipped,
    message: applied.applied.length === 0 ? "Nothing could be applied: " + (applied.skipped.map((s) => s.reason).join(" ") || "no change.") : null,
  });
}
