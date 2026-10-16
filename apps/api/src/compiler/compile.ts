import {
  siteConfigurationSchema,
  type ConfigurationValidationResult,
  type ModuleType,
  type SiteConfiguration,
  type ValidationIssue,
} from "@opshub/contracts";
import { getModuleDefinition, isCompatible, moduleDefinitions } from "../modules/registry.js";
import { checkExpression } from "./expression.js";
import { migrateConfiguration } from "./migrate.js";

export interface CompileOutput {
  result: ConfigurationValidationResult;
  /** Present only when there are no blocking errors. */
  compiled?: SiteConfiguration;
}

const error = (stage: string, code: string, message: string, path?: string): ValidationIssue => ({
  severity: "error",
  stage,
  code,
  message,
  ...(path ? { path } : {}),
});
const warning = (stage: string, code: string, message: string, path?: string): ValidationIssue => ({
  severity: "warning",
  stage,
  code,
  message,
  ...(path ? { path } : {}),
});

function finish(issues: ValidationIssue[], config?: SiteConfiguration): CompileOutput {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const valid = errors.length === 0;
  return { result: { valid, errors, warnings }, ...(valid && config ? { compiled: config } : {}) };
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/**
 * Deterministic configuration pipeline. Stages run in a fixed order; later
 * stages that depend on structural validity are skipped if earlier ones fail.
 * Input is never silently repaired.
 */
export function compileConfiguration(input: unknown): CompileOutput {
  // Stages 1-3: parse, schema version migration, schema validation.
  const migrated = migrateConfiguration(input);
  if (!migrated.ok) return finish([error("schema-version", migrated.code, migrated.message)]);

  const parsed = siteConfigurationSchema.safeParse(migrated.configuration);
  if (!parsed.success) {
    return finish(
      parsed.error.issues.map((i) =>
        error("schema", "schema.invalid", i.message, i.path.map(String).join(".")),
      ),
    );
  }
  const config = parsed.data;
  const issues: ValidationIssue[] = [];

  // Stage 4: resolve module types through the registry.
  const nodeById = new Map(config.modules.nodes.map((n) => [n.id, n]));
  config.modules.nodes.forEach((n, i) => {
    const def = getModuleDefinition(n.moduleType);
    if (!def) {
      issues.push(error("registry", "registry.unknown-module", `Unknown module "${n.moduleType}"`, `modules.nodes.${i}`));
      return;
    }
    for (const key of Object.keys(n.config)) {
      if (!def.configFields.some((f) => f.key === key)) {
        issues.push(error("registry", "registry.unknown-config-key", `"${key}" is not a config field of ${n.moduleType}`, `modules.nodes.${i}.config.${key}`));
      }
    }
    for (const f of def.configFields) {
      const v = n.config[f.key];
      if (v === undefined) {
        if (f.required) issues.push(error("registry", "registry.config-required", `${f.key} is required`, `modules.nodes.${i}.config.${f.key}`));
      } else if (typeof v !== f.type) {
        issues.push(error("registry", "registry.config-type", `${f.key} must be a ${f.type}`, `modules.nodes.${i}.config.${f.key}`));
      }
    }
  });

  // Stage 5: unique ids.
  for (const id of duplicates(config.modules.nodes.map((n) => n.id))) {
    issues.push(error("graph", "graph.duplicate-node", `Duplicate node id "${id}"`));
  }
  for (const id of duplicates(config.modules.edges.map((e) => e.id))) {
    issues.push(error("graph", "graph.duplicate-edge", `Duplicate edge id "${id}"`));
  }
  const nodeTypes = config.modules.nodes.map((n) => n.moduleType);
  for (const t of duplicates(nodeTypes)) {
    issues.push(error("graph", "graph.duplicate-module", `Module "${t}" is enabled more than once`));
  }

  // Stages 6-8: node references, ports, data-type compatibility.
  config.modules.edges.forEach((e, i) => {
    const p = `modules.edges.${i}`;
    const src = nodeById.get(e.sourceNodeId);
    const tgt = nodeById.get(e.targetNodeId);
    if (!src) issues.push(error("graph", "graph.missing-node", `Edge ${e.id}: source node "${e.sourceNodeId}" not found`, p));
    if (!tgt) issues.push(error("graph", "graph.missing-node", `Edge ${e.id}: target node "${e.targetNodeId}" not found`, p));
    if (!src || !tgt) return;
    const srcPort = getModuleDefinition(src.moduleType)?.ports.find((x) => x.id === e.sourcePortId);
    const tgtPort = getModuleDefinition(tgt.moduleType)?.ports.find((x) => x.id === e.targetPortId);
    if (!srcPort || srcPort.direction !== "output") {
      issues.push(error("ports", "ports.invalid-source", `Edge ${e.id}: "${e.sourcePortId}" is not an output port of ${src.moduleType}`, p));
    }
    if (!tgtPort || tgtPort.direction !== "input") {
      issues.push(error("ports", "ports.invalid-target", `Edge ${e.id}: "${e.targetPortId}" is not an input port of ${tgt.moduleType}`, p));
    }
    if (srcPort && tgtPort && srcPort.direction === "output" && tgtPort.direction === "input" && !isCompatible(srcPort.dataType, tgtPort.dataType)) {
      issues.push(error("ports", "ports.incompatible", `Edge ${e.id}: ${srcPort.dataType} cannot connect to ${tgtPort.dataType}`, p));
    }
  });

  // Stage 9: module dependencies and mandatory platform modules.
  const enabled = new Set(nodeTypes);
  for (const n of config.modules.nodes) {
    for (const dep of getModuleDefinition(n.moduleType)?.dependencies ?? []) {
      if (!enabled.has(dep)) {
        issues.push(error("dependencies", "dependencies.missing", `Module "${n.moduleType}" requires "${dep}"`, `modules.nodes.${n.id}`));
      }
    }
  }
  for (const def of platformModuleTypes()) {
    if (!enabled.has(def)) issues.push(error("dependencies", "dependencies.platform-required", `Platform module "${def}" is mandatory and cannot be removed`));
  }

  // Stage 10: cycles in the module dependency graph and in the edge graph.
  const depGraph = new Map<string, string[]>();
  for (const n of config.modules.nodes) depGraph.set(n.moduleType, getModuleDefinition(n.moduleType)?.dependencies ?? []);
  if (hasCycle(depGraph)) issues.push(error("cycles", "cycles.dependency", "Module dependencies contain a cycle"));
  const edgeGraph = new Map<string, string[]>();
  for (const n of config.modules.nodes) edgeGraph.set(n.id, []);
  for (const e of config.modules.edges) edgeGraph.get(e.sourceNodeId)?.push(e.targetNodeId);
  if (hasCycle(edgeGraph)) issues.push(error("cycles", "cycles.edges", "Module connections form a cycle"));

  // Stage 11: pages and layouts.
  const layoutIds = new Set(config.layouts.map((l) => l.id));
  const pageIds = new Set(config.pages.map((p) => p.id));
  for (const id of duplicates(config.pages.map((p) => p.id))) issues.push(error("pages", "pages.duplicate", `Duplicate page id "${id}"`));
  for (const id of duplicates(config.pages.map((p) => p.path))) issues.push(error("pages", "pages.duplicate-path", `Duplicate page path "${id}"`));
  config.pages.forEach((p, i) => {
    if (!nodeById.has(p.nodeId)) issues.push(error("pages", "pages.missing-node", `Page "${p.id}" references unknown node "${p.nodeId}"`, `pages.${i}`));
    if (!layoutIds.has(p.layoutId)) issues.push(error("pages", "pages.missing-layout", `Page "${p.id}" references unknown layout "${p.layoutId}"`, `pages.${i}`));
  });
  config.navigation.forEach((n, i) => {
    if (!pageIds.has(n.pageId)) issues.push(error("pages", "navigation.missing-page", `Navigation references unknown page "${n.pageId}"`, `navigation.${i}`));
  });
  for (const n of config.modules.nodes) {
    if (!config.pages.some((p) => p.nodeId === n.id) && n.moduleType !== "auth-rbac") {
      issues.push(warning("pages", "pages.module-without-page", `Module "${n.moduleType}" has no page`, `modules.nodes.${n.id}`));
    }
  }

  // Stage 12: roles and permissions.
  const known = new Set(config.modules.nodes.flatMap((n) => getModuleDefinition(n.moduleType)?.permissions ?? []));
  for (const id of duplicates(config.roles.map((r) => r.id))) issues.push(error("roles", "roles.duplicate", `Duplicate role id "${id}"`));
  config.roles.forEach((r, i) => {
    for (const perm of r.permissions) {
      if (!known.has(perm)) issues.push(error("roles", "roles.unknown-permission", `Role "${r.id}" grants "${perm}", which no enabled module defines`, `roles.${i}`));
    }
  });
  config.pages.forEach((p, i) => {
    if (p.requiredPermission && !known.has(p.requiredPermission)) {
      issues.push(error("roles", "pages.unknown-permission", `Page "${p.id}" requires unknown permission "${p.requiredPermission}"`, `pages.${i}`));
    }
  });

  // Stage 13: workflow transitions.
  config.workflowDefinitions.forEach((w, i) => {
    const states = new Set(w.states);
    if (!states.has(w.initial)) issues.push(error("workflows", "workflows.bad-initial", `Workflow "${w.id}" initial state "${w.initial}" is not declared`, `workflowDefinitions.${i}`));
    for (const t of w.transitions) {
      if (!states.has(t.from) || !states.has(t.to)) {
        issues.push(error("workflows", "workflows.bad-transition", `Workflow "${w.id}" transition ${t.from} -> ${t.to} uses an undeclared state`, `workflowDefinitions.${i}`));
      }
      if (t.permission && !known.has(t.permission)) {
        issues.push(error("workflows", "workflows.unknown-permission", `Workflow "${w.id}" transition requires unknown permission "${t.permission}"`, `workflowDefinitions.${i}`));
      }
    }
  });

  // Stage 14: calculated-field expressions (parsed and type-checked, never executed).
  config.calculatedFieldDefinitions.forEach((f, i) => {
    const checked = checkExpression(f.expression, f.inputs);
    for (const iss of checked.issues) issues.push(error("expressions", iss.code, `${f.id}: ${iss.message}`, `calculatedFieldDefinitions.${i}`));
    if (checked.resultType && checked.resultType !== f.resultType) {
      issues.push(error("expressions", "expression.result-type", `${f.id}: expression yields ${checked.resultType}, declared ${f.resultType}`, `calculatedFieldDefinitions.${i}`));
    }
  });

  // Stages 15-16.
  return finish(issues, config);
}

function platformModuleTypes(): ModuleType[] {
  return moduleDefinitions.filter((m) => m.platformModule).map((m) => m.type);
}

export function hasCycle(graph: Map<string, string[]>): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 2) return false;
    if (state.get(n) === 1) return true;
    state.set(n, 1);
    for (const m of graph.get(n) ?? []) if (visit(m)) return true;
    state.set(n, 2);
    return false;
  };
  return [...graph.keys()].some(visit);
}
