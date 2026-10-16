import type { FieldDefinition, SiteConfiguration } from "@opshub/contracts";
import { getModuleDefinition } from "../modules/registry.js";

const ENTITY_LABEL: Record<string, string> = { inventory_item: "inventory items", request_line: "request lines" };
const entityLabel = (e: string) => ENTITY_LABEL[e] ?? e;
const moduleName = (type: string) => getModuleDefinition(type as never)?.displayName ?? type;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fieldKey = (f: Pick<FieldDefinition, "entity" | "key">) => `${f.entity}.${f.key}`;

/** Rows holding data per `entity.key`; supplied by the impact service so sentences can mention real counts. */
export type FieldDataCounts = ReadonlyMap<string, number>;

/**
 * Deterministic plain-English description of what changes when `to` replaces `from`.
 * Templates only (no model involved): the same inputs always produce the same sentences.
 */
export function describeChanges(from: SiteConfiguration | null, to: SiteConfiguration, counts: FieldDataCounts = new Map()): string[] {
  const out: string[] = [];
  const fromNodes = new Map((from?.modules.nodes ?? []).map((n) => [n.id, n]));
  const toNodes = new Map(to.modules.nodes.map((n) => [n.id, n]));

  if (!from) out.push(`This is the first release for “${to.name}”.`);

  const added = [...toNodes.values()].filter((n) => !fromNodes.has(n.id));
  const removed = [...fromNodes.values()].filter((n) => !toNodes.has(n.id));
  for (const n of added) {
    const page = to.pages.find((p) => p.nodeId === n.id);
    out.push(page ? `The “${moduleName(n.moduleType)}” module is added, with a new “${page.title}” tab in the menu.` : `The “${moduleName(n.moduleType)}” module is added.`);
  }
  for (const n of removed) {
    const page = from?.pages.find((p) => p.nodeId === n.id);
    out.push(page ? `The “${moduleName(n.moduleType)}” module is removed, and its “${page.title}” tab disappears from the menu.` : `The “${moduleName(n.moduleType)}” module is removed.`);
  }

  // Page titles on pages present in both.
  for (const p of to.pages) {
    const before = from?.pages.find((x) => x.id === p.id);
    if (before && before.title !== p.title) out.push(`The “${before.title}” tab is renamed to “${p.title}”.`);
  }

  // Module settings (the approval deadline gets its own wording).
  for (const [id, n] of toNodes) {
    const before = fromNodes.get(id);
    if (!before) continue;
    for (const k of [...new Set([...Object.keys(before.config), ...Object.keys(n.config)])].sort()) {
      const a = before.config[k];
      const b = n.config[k];
      if (a === b) continue;
      const who = moduleName(n.moduleType).toLowerCase();
      if (k === "slaSeconds") {
        out.push(
          a === undefined
            ? `Pending ${who} requests now turn overdue after ${plural(Number(b), "second")}.`
            : b === undefined
              ? `Pending ${who} requests no longer have a deadline.`
              : `The deadline for pending ${who} requests changes from ${plural(Number(a), "second")} to ${plural(Number(b), "second")}.`,
        );
      } else {
        out.push(`Setting “${k}” on “${moduleName(n.moduleType)}” changes from ${a === undefined ? "not set" : String(a)} to ${b === undefined ? "not set" : String(b)}.`);
      }
    }
  }

  // Fields.
  const fromFields = new Map((from?.fields ?? []).map((f) => [fieldKey(f), f]));
  const toFields = new Map(to.fields.map((f) => [fieldKey(f), f]));
  for (const [k, f] of toFields) {
    const before = fromFields.get(k);
    if (!before) {
      out.push(`A new ${f.type} field “${f.label}” is added to ${entityLabel(f.entity)}${f.required ? " and is required" : ""}${f.hidden ? " (hidden)" : ""}.`);
      continue;
    }
    if (!before.hidden && f.hidden) {
      const n = counts.get(k) ?? 0;
      out.push(`The “${f.label}” field is hidden on ${entityLabel(f.entity)}. ${n === 0 ? "No saved values are affected." : `${plural(n, "row")} keep${n === 1 ? "s" : ""} the saved value, and it comes back if the field is shown again.`}`);
    } else if (before.hidden && !f.hidden) {
      out.push(`The “${f.label}” field is shown again on ${entityLabel(f.entity)}; existing values reappear.`);
    }
    if (before.label !== f.label) out.push(`The field “${before.label}” on ${entityLabel(f.entity)} is renamed to “${f.label}”.`);
    if (before.type !== f.type) out.push(`The “${f.label}” field on ${entityLabel(f.entity)} changes type from ${before.type} to ${f.type}.`);
    if (!before.required && f.required) out.push(`The “${f.label}” field on ${entityLabel(f.entity)} becomes required.`);
    if (before.required && !f.required) out.push(`The “${f.label}” field on ${entityLabel(f.entity)} is no longer required.`);
  }
  for (const [k, f] of fromFields) {
    if (toFields.has(k)) continue;
    const n = counts.get(k) ?? 0;
    out.push(`The “${f.label}” field is removed from ${entityLabel(f.entity)}.${n > 0 ? ` ${plural(n, "row")} still hold${n === 1 ? "s" : ""} a value that will no longer be shown.` : ""}`);
  }

  // Roles.
  const fromRoles = new Map((from?.roles ?? []).map((r) => [r.id, r]));
  for (const r of to.roles) {
    const before = fromRoles.get(r.id);
    if (!before) {
      if (from) out.push(`A new role “${r.name}” is created with ${plural(r.permissions.length, "permission")}.`);
      continue;
    }
    const gained = r.permissions.filter((p) => !before.permissions.includes(p)).sort();
    const lost = before.permissions.filter((p) => !r.permissions.includes(p)).sort();
    if (gained.length) out.push(`The “${r.name}” role gains ${plural(gained.length, "permission")}: ${list(gained)}.`);
    if (lost.length) out.push(`The “${r.name}” role loses ${plural(lost.length, "permission")}: ${list(lost)}.`);
  }
  for (const r of from?.roles ?? []) if (!to.roles.some((x) => x.id === r.id)) out.push(`The “${r.name}” role is removed.`);

  // Workflows and calculated values.
  for (const w of to.workflowDefinitions) {
    const before = from?.workflowDefinitions.find((x) => x.id === w.id);
    if (!before) continue;
    const key = (t: { from: string; to: string }) => `${t.from}→${t.to}`;
    const a = new Set(before.transitions.map(key));
    const b = new Set(w.transitions.map(key));
    for (const t of b) if (!a.has(t)) out.push(`The “${w.id}” workflow now allows ${t.replace("→", " to ")}.`);
    for (const t of a) if (!b.has(t)) out.push(`The “${w.id}” workflow no longer allows ${t.replace("→", " to ")}.`);
  }
  const fromCalc = new Set((from?.calculatedFieldDefinitions ?? []).map((c) => c.id));
  for (const c of to.calculatedFieldDefinitions) if (!fromCalc.has(c.id)) out.push(`A new calculated value “${c.label}” is added.`);
  for (const c of from?.calculatedFieldDefinitions ?? []) if (!to.calculatedFieldDefinitions.some((x) => x.id === c.id)) out.push(`The calculated value “${c.label}” is removed.`);

  // Look and feel.
  if (from) {
    if (from.name !== to.name) out.push(`The site is renamed from “${from.name}” to “${to.name}”.`);
    if (from.shell !== to.shell) out.push(`The layout shell changes from ${from.shell} to ${to.shell}.`);
    if (from.theme.primary !== to.theme.primary || from.theme.secondary !== to.theme.secondary) out.push("The site colours change.");
  }

  return out.length ? out : ["No changes."];
}
