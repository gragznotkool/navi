import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { PresetSummary } from "@opshub/contracts";
import { getModuleDefinition } from "../modules/registry.js";

const presetsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../config/presets");

const presetFileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  description: z.string().min(1),
  /** A site configuration without identity (siteId, slug, name), which provisioning fills in. */
  template: z.record(z.string(), z.unknown()),
});
export type Preset = z.infer<typeof presetFileSchema>;

let cache: Preset[] | null = null;

/** Presets are read from `config/presets/*.json` once and validated for shape; the compiler validates content at provision time. */
export function loadPresets(): Preset[] {
  cache ??= readdirSync(presetsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => presetFileSchema.parse(JSON.parse(readFileSync(join(presetsDir, f), "utf8"))));
  return cache;
}

export const getPreset = (id: string): Preset | undefined => loadPresets().find((p) => p.id === id);

/** Identity is injected by the server, never taken from the template or the client's configuration. */
export function buildConfiguration(preset: Preset, identity: { siteId: string; slug: string; name: string }): unknown {
  return { ...preset.template, siteId: identity.siteId, slug: identity.slug, name: identity.name };
}

export function summarize(p: Preset): PresetSummary {
  const nodes = (p.template.modules as { nodes?: { moduleType: string }[] } | undefined)?.nodes ?? [];
  return {
    id: p.id,
    label: p.label,
    description: p.description,
    modules: nodes.filter((n) => !getModuleDefinition(n.moduleType as never)?.platformModule).map((n) => getModuleDefinition(n.moduleType as never)?.displayName ?? n.moduleType),
    shell: String(p.template.shell ?? ""),
  };
}

export const roleIdsOf = (config: { roles: { id: string }[] }): string[] => config.roles.map((r) => r.id);
