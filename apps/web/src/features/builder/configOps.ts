import type { ModuleDefinition, ModuleEdge, SiteConfiguration } from "@opshub/contracts";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Pure edits to a site configuration. These only produce a candidate: the server-side compiler
 * remains the sole authority on whether the result is valid or publishable.
 */
export function addModule(config: SiteConfiguration, def: ModuleDefinition, position: { x: number; y: number }): SiteConfiguration {
  if (config.modules.nodes.some((n) => n.moduleType === def.type)) return config;
  const next = clone(config);
  next.modules.nodes.push({ id: def.type, moduleType: def.type, position, config: { ...def.defaults } });

  let path = slugify(def.displayName.replace(/,.*$/, ""));
  while (next.pages.some((p) => p.path === path) || path === "admin") path += "-2";
  const layout = next.layouts.find((l) => l.type === "data-table") ?? next.layouts[0];
  const viewPermission = def.permissions.find((p) => p.endsWith(":view"));
  if (layout && def.type !== "auth-rbac") {
    next.pages.push({ id: path, title: def.displayName, path, nodeId: def.type, layoutId: layout.id, ...(viewPermission ? { requiredPermission: viewPermission } : {}) });
    next.navigation.push({ pageId: path, label: def.displayName });
  }
  // The administrator role receives the new module's permissions; other roles are edited elsewhere.
  const admin = next.roles.find((r) => r.id === "admin");
  if (admin) for (const p of def.permissions) if (!admin.permissions.includes(p)) admin.permissions.push(p);
  return next;
}

export function removeModule(config: SiteConfiguration, nodeId: string, registry: readonly ModuleDefinition[]): SiteConfiguration {
  const next = clone(config);
  next.modules.nodes = next.modules.nodes.filter((n) => n.id !== nodeId);
  next.modules.edges = next.modules.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId);
  const removedPages = next.pages.filter((p) => p.nodeId === nodeId).map((p) => p.id);
  next.pages = next.pages.filter((p) => p.nodeId !== nodeId);
  next.navigation = next.navigation.filter((n) => !removedPages.includes(n.pageId));
  const stillDefined = new Set(next.modules.nodes.flatMap((n) => registry.find((d) => d.type === n.moduleType)?.permissions ?? []));
  for (const r of next.roles) r.permissions = r.permissions.filter((p) => stillDefined.has(p));
  return next;
}

export function setNodeConfig(config: SiteConfiguration, nodeId: string, key: string, value: string | number | boolean | undefined): SiteConfiguration {
  const next = clone(config);
  const node = next.modules.nodes.find((n) => n.id === nodeId);
  if (!node) return config;
  if (value === undefined) delete node.config[key];
  else node.config[key] = value;
  return next;
}

export function moveNode(config: SiteConfiguration, nodeId: string, position: { x: number; y: number }): SiteConfiguration {
  const next = clone(config);
  const node = next.modules.nodes.find((n) => n.id === nodeId);
  if (node) node.position = position;
  return next;
}

export function addEdge(config: SiteConfiguration, edge: Omit<ModuleEdge, "id">): SiteConfiguration {
  const id = `${edge.sourceNodeId}.${edge.sourcePortId}->${edge.targetNodeId}.${edge.targetPortId}`;
  if (config.modules.edges.some((e) => e.id === id)) return config;
  const next = clone(config);
  next.modules.edges.push({ id, ...edge });
  return next;
}

export function removeEdge(config: SiteConfiguration, edgeId: string): SiteConfiguration {
  const next = clone(config);
  next.modules.edges = next.modules.edges.filter((e) => e.id !== edgeId);
  return next;
}

/** Port-level connection check for UX. The server compiler re-checks everything on validate/publish. */
export function canConnect(
  registry: readonly ModuleDefinition[],
  dataTypes: readonly { id: string; assignableTo: string[] }[],
  c: { sourceNodeId: string; sourcePortId: string; targetNodeId: string; targetPortId: string },
  config: SiteConfiguration,
): boolean {
  if (c.sourceNodeId === c.targetNodeId) return false;
  const src = config.modules.nodes.find((n) => n.id === c.sourceNodeId);
  const tgt = config.modules.nodes.find((n) => n.id === c.targetNodeId);
  const sp = registry.find((d) => d.type === src?.moduleType)?.ports.find((p) => p.id === c.sourcePortId);
  const tp = registry.find((d) => d.type === tgt?.moduleType)?.ports.find((p) => p.id === c.targetPortId);
  if (!sp || !tp || sp.direction !== "output" || tp.direction !== "input") return false;
  return sp.dataType === tp.dataType || (dataTypes.find((d) => d.id === sp.dataType)?.assignableTo.includes(tp.dataType) ?? false);
}
