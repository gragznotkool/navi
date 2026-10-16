import type { ConfigPatch, ModuleDefinition, PatchOp, SiteConfiguration } from "@opshub/contracts";
import { getModuleDefinition, moduleDefinitions } from "../modules/registry.js";

const registryPermissions: ReadonlySet<string> = new Set(moduleDefinitions.flatMap((d) => d.permissions));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Permissions a spoken or model-generated instruction may never hand out. Changing who can reconfigure
 * the site, publish, or manage users has to be done deliberately in the builder, not by a sentence.
 */
export const AI_FORBIDDEN_PERMISSIONS: ReadonlySet<string> = new Set(["config:manage", "release:publish", "auth:manage", "user:manage"]);

export interface AppliedPatch {
  configuration: SiteConfiguration;
  skipped: { op: string; reason: string }[];
  applied: PatchOp[];
}

const FRIENDLY_NAV: Record<string, { title: string; path: string; label: string }> = {
  "return-management": { title: "Returns", path: "returns", label: "Returns" },
};

function addModule(next: SiteConfiguration, def: ModuleDefinition): void {
  next.modules.nodes.push({ id: def.type, moduleType: def.type, position: { x: 80 * next.modules.nodes.length, y: 360 }, config: { ...def.defaults } });
  const friendly = FRIENDLY_NAV[def.type];
  let path = friendly?.path ?? slugify(def.displayName.replace(/,.*$/, ""));
  while (next.pages.some((p) => p.path === path) || path === "admin") path += "-2";
  const layout = next.layouts.find((l) => l.type === "data-table") ?? next.layouts[0];
  const view = def.permissions.find((p) => p.endsWith(":view"));
  if (layout && def.type !== "auth-rbac") {
    next.pages.push({ id: path, title: friendly?.title ?? def.displayName, path, nodeId: def.type, layoutId: layout.id, ...(view ? { requiredPermission: view } : {}) });
    next.navigation.push({ pageId: path, label: friendly?.label ?? def.displayName });
  }
  const admin = next.roles.find((r) => r.id === "admin");
  if (admin) for (const p of def.permissions) if (!admin.permissions.includes(p)) admin.permissions.push(p);
}

function removeModule(next: SiteConfiguration, nodeId: string): void {
  next.modules.nodes = next.modules.nodes.filter((n) => n.id !== nodeId);
  next.modules.edges = next.modules.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId);
  const removedPages = next.pages.filter((p) => p.nodeId === nodeId).map((p) => p.id);
  next.pages = next.pages.filter((p) => p.nodeId !== nodeId);
  next.navigation = next.navigation.filter((n) => !removedPages.includes(n.pageId));
  const stillDefined = new Set(next.modules.nodes.flatMap((n) => getModuleDefinition(n.moduleType)?.permissions ?? []));
  // Keep a permission unless it belongs to a module that is no longer on the site.
  for (const r of next.roles) r.permissions = r.permissions.filter((p) => stillDefined.has(p) || !registryPermissions.has(p));
}

/**
 * Applies already-validated ops to a COPY of the configuration. An op that cannot be applied is reported in
 * `skipped` with a reason; the rest still apply. The result is not trusted: it must still pass the compiler.
 */
export function applyPatch(base: SiteConfiguration, patch: ConfigPatch): AppliedPatch {
  const next = clone(base);
  const skipped: AppliedPatch["skipped"] = [];
  const applied: PatchOp[] = [];

  for (const op of patch.ops) {
    switch (op.op) {
      case "add-module": {
        const def = getModuleDefinition(op.moduleType);
        if (!def) skipped.push({ op: op.op, reason: `Unknown module “${op.moduleType}”.` });
        else if (next.modules.nodes.some((n) => n.moduleType === op.moduleType)) skipped.push({ op: op.op, reason: `${def.displayName} is already part of this site.` });
        else {
          addModule(next, def);
          applied.push(op);
        }
        break;
      }
      case "remove-module": {
        const def = getModuleDefinition(op.moduleType);
        const node = next.modules.nodes.find((n) => n.moduleType === op.moduleType);
        if (!def || !node) skipped.push({ op: op.op, reason: `${def?.displayName ?? op.moduleType} is not part of this site.` });
        else if (def.platformModule) skipped.push({ op: op.op, reason: `${def.displayName} is a platform module and cannot be removed.` });
        else {
          removeModule(next, node.id);
          applied.push(op);
        }
        break;
      }
      case "rename-site": {
        if (op.name === next.name) skipped.push({ op: op.op, reason: "The site already has that name." });
        else {
          next.name = op.name;
          applied.push(op);
        }
        break;
      }
      case "grant-permission": {
        const key = op.role.trim().toLowerCase();
        const role = next.roles.find((r) => r.id.toLowerCase() === key || r.name.toLowerCase() === key);
        const offered = new Set(next.modules.nodes.flatMap((n) => getModuleDefinition(n.moduleType)?.permissions ?? []));
        if (AI_FORBIDDEN_PERMISSIONS.has(op.permission)) skipped.push({ op: op.op, reason: `“${op.permission}” can only be granted deliberately in the builder, not by an instruction.` });
        else if (!role) skipped.push({ op: op.op, reason: `This site has no role called “${op.role}”.` });
        else if (!offered.has(op.permission)) skipped.push({ op: op.op, reason: `No module on this site offers the permission “${op.permission}”.` });
        else if (role.permissions.includes(op.permission)) skipped.push({ op: op.op, reason: `${role.name} already has “${op.permission}”.` });
        else {
          role.permissions.push(op.permission);
          applied.push(op);
        }
        break;
      }
    }
  }
  return { configuration: next, skipped, applied };
}
