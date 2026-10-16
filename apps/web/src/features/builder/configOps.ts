import type { CalculatedFieldDefinition, CustomFieldDefinition, FieldDefinition, ModuleDefinition, ModuleEdge, SiteConfiguration } from "@opshub/contracts";

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
  next.customFields = next.customFields.filter((f) => f.nodeId !== nodeId);
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

export const edgeIdOf = (e: Omit<ModuleEdge, "id">): string => `${e.sourceNodeId}.${e.sourcePortId}->${e.targetNodeId}.${e.targetPortId}`;

export function removeEdge(config: SiteConfiguration, edgeId: string): SiteConfiguration {
  const next = clone(config);
  next.modules.edges = next.modules.edges.filter((e) => e.id !== edgeId);
  return next;
}

type PortConnection = { sourceNodeId: string; sourcePortId: string; targetNodeId: string; targetPortId: string };
type DataTypes = readonly { id: string; assignableTo: string[] }[];

/**
 * Why a connection is not allowed, in words a builder user can act on (null when it is allowed).
 * Mirrors the server compiler's graph rules; the server remains the authority on validate/publish.
 */
export function explainConnection(registry: readonly ModuleDefinition[], dataTypes: DataTypes, c: PortConnection, config: SiteConfiguration): string | null {
  if (c.sourceNodeId === c.targetNodeId) return "Self-connection: a module cannot feed itself.";
  const src = config.modules.nodes.find((n) => n.id === c.sourceNodeId);
  const tgt = config.modules.nodes.find((n) => n.id === c.targetNodeId);
  const sd = registry.find((d) => d.type === src?.moduleType);
  const td = registry.find((d) => d.type === tgt?.moduleType);
  const sp = sd?.ports.find((p) => p.id === c.sourcePortId);
  const tp = td?.ports.find((p) => p.id === c.targetPortId);
  if (!sd || !td || !sp || !tp) return "Unknown module or port.";
  if (sp.direction !== "output" || tp.direction !== "input") return "Direction: connect an output port to an input port.";
  const compatible = sp.dataType === tp.dataType || (dataTypes.find((d) => d.id === sp.dataType)?.assignableTo.includes(tp.dataType) ?? false);
  if (!compatible) {
    return `Incompatible Port: ${td.displayName} module requires a ${tp.label} input stream, but ${sd.displayName} outputs ${sp.label}.`;
  }
  // The new edge closes a loop when the target can already reach the source.
  const next = new Map<string, string[]>();
  for (const e of config.modules.edges) next.set(e.sourceNodeId, [...(next.get(e.sourceNodeId) ?? []), e.targetNodeId]);
  const stack = [c.targetNodeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === c.sourceNodeId) return `Circular wiring: ${td.displayName} already feeds ${sd.displayName}.`;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return null;
}

/** Port-level connection check for UX. The server compiler re-checks everything on validate/publish. */
export function canConnect(registry: readonly ModuleDefinition[], dataTypes: DataTypes, c: PortConnection, config: SiteConfiguration): boolean {
  return explainConnection(registry, dataTypes, c, config) === null;
}

/** Problems a freshly placed module has on its own (missing dependencies, nothing feeding its inputs). */
export function isolationProblem(registry: readonly ModuleDefinition[], config: SiteConfiguration, nodeId: string): string | null {
  const node = config.modules.nodes.find((n) => n.id === nodeId);
  const def = registry.find((d) => d.type === node?.moduleType);
  if (!node || !def) return null;
  const missing = def.dependencies.filter((d) => !config.modules.nodes.some((n) => n.moduleType === d));
  if (missing.length > 0) {
    const names = missing.map((m) => registry.find((d) => d.type === m)?.displayName ?? m).join(", ");
    return `${def.displayName} needs ${names} in the graph first.`;
  }
  const inputs = def.ports.filter((p) => p.direction === "input" && p.dataType !== "identity");
  const fed = (portId: string) => config.modules.edges.some((e) => e.targetNodeId === nodeId && e.targetPortId === portId);
  if (inputs.length > 0 && inputs.every((p) => !fed(p.id))) {
    return `Isolated: ${def.displayName} has no incoming ${inputs.map((p) => p.label).join(" / ")} stream.`;
  }
  return null;
}

// ---------------------------------------------------------------- inspector edits

export function setRolePermission(config: SiteConfiguration, roleId: string, permission: string, granted: boolean): SiteConfiguration {
  const next = clone(config);
  const role = next.roles.find((r) => r.id === roleId);
  if (!role) return config;
  role.permissions = granted ? [...new Set([...role.permissions, permission])] : role.permissions.filter((p) => p !== permission);
  return next;
}

export function addCustomField(config: SiteConfiguration, nodeId: string): SiteConfiguration {
  const next = clone(config);
  let n = next.customFields.filter((f) => f.nodeId === nodeId).length + 1;
  while (next.customFields.some((f) => f.nodeId === nodeId && f.name === `field${n}`)) n++;
  next.customFields.push({ id: `${nodeId}.field${n}`, nodeId, name: `field${n}`, type: "string", required: false });
  return next;
}

export function updateCustomField(config: SiteConfiguration, id: string, patch: Partial<Omit<CustomFieldDefinition, "id" | "nodeId">>): SiteConfiguration {
  const next = clone(config);
  const f = next.customFields.find((x) => x.id === id);
  if (f) Object.assign(f, patch);
  return next;
}

export function removeCustomField(config: SiteConfiguration, id: string): SiteConfiguration {
  const next = clone(config);
  next.customFields = next.customFields.filter((f) => f.id !== id);
  return next;
}

export function addCalculatedField(config: SiteConfiguration): SiteConfiguration {
  const next = clone(config);
  let n = next.calculatedFieldDefinitions.length + 1;
  while (next.calculatedFieldDefinitions.some((f) => f.id === `calc-${n}`)) n++;
  next.calculatedFieldDefinitions.push({ id: `calc-${n}`, label: `Calculated field ${n}`, expression: "a + b", inputs: { a: "number", b: "number" }, resultType: "number" });
  return next;
}

export function updateCalculatedField(config: SiteConfiguration, id: string, patch: Partial<Omit<CalculatedFieldDefinition, "id">>): SiteConfiguration {
  const next = clone(config);
  const f = next.calculatedFieldDefinitions.find((x) => x.id === id);
  if (f) Object.assign(f, patch);
  return next;
}

export function removeCalculatedField(config: SiteConfiguration, id: string): SiteConfiguration {
  const next = clone(config);
  next.calculatedFieldDefinitions = next.calculatedFieldDefinitions.filter((f) => f.id !== id);
  return next;
}

/** Adds a field, or returns the config unchanged when the entity already has that key. */
export function addField(config: SiteConfiguration, field: Omit<FieldDefinition, "id">): SiteConfiguration {
  if (config.fields.some((f) => f.entity === field.entity && f.key === field.key)) return config;
  const next = clone(config);
  let id = `${field.entity}-${field.key}`.replace(/_/g, "-");
  while (next.fields.some((f) => f.id === id)) id += "-2";
  next.fields.push({ id, ...field });
  return next;
}

export function updateField(config: SiteConfiguration, id: string, patch: Partial<Pick<FieldDefinition, "label" | "type" | "required" | "hidden">>): SiteConfiguration {
  const next = clone(config);
  const f = next.fields.find((x) => x.id === id);
  if (f) Object.assign(f, patch);
  return next;
}

export function removeField(config: SiteConfiguration, id: string): SiteConfiguration {
  const next = clone(config);
  next.fields = next.fields.filter((f) => f.id !== id);
  return next;
}
