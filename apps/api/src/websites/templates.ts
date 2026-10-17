import { CURRENT_SCHEMA_VERSION, getWebsiteTheme, type ModuleType, type WebsiteTemplate, type WebsiteTheme } from "@opshub/contracts";
import { getModuleDefinition } from "../modules/registry.js";

/** [source module, output port, target module, input port] */
type Wire = [ModuleType, string, ModuleType, string];

interface TemplateDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Preset used only to label the provisioning job; the graph below is the configuration. */
  presetId: string;
  themeId: string;
  /** Business modules (platform modules are always added). */
  modules: ModuleType[];
  wires: Wire[];
  /** Operational role besides admin and viewer, e.g. "technician". */
  staffRole: string;
  /** Node settings that differ from the module defaults. */
  settings?: Partial<Record<ModuleType, Record<string, number | string | boolean>>>;
}

/**
 * Six ready-made websites, each a different, fully wired module graph: every module has at least
 * one connection, so nothing on the canvas is left dangling.
 */
const TEMPLATE_DEFS: readonly TemplateDef[] = [
  {
    id: "ocean-breeze",
    name: "Ocean Breeze",
    tagline: "Clean corporate",
    description: "Stock control: inventory feeding Excel reports and live analytics.",
    presetId: "stores",
    themeId: "ocean-breeze",
    modules: ["user-management", "inventory", "reports-excel", "analytics-dashboard"],
    wires: [
      ["inventory", "stock-out", "reports-excel", "stock-in"],
      ["inventory", "stock-out", "analytics-dashboard", "metric-in"],
    ],
    staffRole: "storekeeper",
    settings: { inventory: { lowStockThreshold: 15 } },
  },
  {
    id: "coral-garden",
    name: "Coral Garden",
    tagline: "Warm & friendly",
    description: "Service desk: parts requests with approval, plus PCB repair tracking.",
    presetId: "service-centre",
    themeId: "coral-garden",
    modules: ["inventory", "request", "approval", "pcb-repair", "analytics-dashboard"],
    wires: [
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["pcb-repair", "repair-out", "analytics-dashboard", "metric-in"],
    ],
    staffRole: "technician",
    settings: { approval: { slaHours: 24, reminderHours: 8 } },
  },
  {
    id: "lavender-fields",
    name: "Lavender Fields",
    tagline: "Modern & elegant",
    description: "Distribution: request → approval → assignment, with a workbench and consumption.",
    presetId: "distribution",
    themeId: "lavender-fields",
    modules: ["inventory", "request", "approval", "material-assignment", "assignment-frontend", "consumption-tracking", "analytics-dashboard"],
    wires: [
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["approval", "approved-out", "material-assignment", "approved-in"],
      ["material-assignment", "assignment-out", "assignment-frontend", "assignment-in"],
      ["material-assignment", "assignment-out", "consumption-tracking", "assignment-in"],
      ["consumption-tracking", "consumption-out", "analytics-dashboard", "metric-in"],
    ],
    staffRole: "dispatcher",
    settings: { approval: { slaHours: 48 } },
  },
  {
    id: "emerald-valley",
    name: "Emerald Valley",
    tagline: "Nature & calm",
    description: "Returns & recovery: issued material comes back, tracked to analytics and reports.",
    presetId: "stores",
    themeId: "emerald-valley",
    modules: ["user-management", "inventory", "reports-excel", "request", "approval", "material-assignment", "return-management", "analytics-dashboard"],
    wires: [
      ["inventory", "stock-out", "reports-excel", "stock-in"],
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["approval", "approved-out", "material-assignment", "approved-in"],
      ["material-assignment", "assignment-out", "return-management", "assignment-in"],
      ["return-management", "return-out", "analytics-dashboard", "metric-in"],
    ],
    staffRole: "storekeeper",
  },
  {
    id: "rose-petal",
    name: "Rose Petal",
    tagline: "Bold & creative",
    description: "Field service: approved parts are consumed or returned, repairs run alongside.",
    presetId: "service-centre",
    themeId: "rose-petal",
    modules: ["inventory", "pcb-repair", "request", "approval", "material-assignment", "consumption-tracking", "return-management", "analytics-dashboard"],
    wires: [
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["approval", "approved-out", "material-assignment", "approved-in"],
      ["material-assignment", "assignment-out", "consumption-tracking", "assignment-in"],
      ["material-assignment", "assignment-out", "return-management", "assignment-in"],
      ["pcb-repair", "repair-out", "analytics-dashboard", "metric-in"],
      ["return-management", "return-out", "analytics-dashboard", "metric-in"],
    ],
    staffRole: "technician",
    settings: { approval: { slaHours: 12, reminderHours: 4 } },
  },
  {
    id: "amber-glow",
    name: "Amber Glow",
    tagline: "Energetic & warm",
    description: "Command centre: every module, from stock to repairs, feeding one analytics hub.",
    presetId: "distribution",
    themeId: "amber-glow",
    modules: ["user-management", "inventory", "reports-excel", "request", "approval", "material-assignment", "assignment-frontend", "consumption-tracking", "return-management", "pcb-repair", "analytics-dashboard"],
    wires: [
      ["inventory", "stock-out", "reports-excel", "stock-in"],
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["approval", "approved-out", "material-assignment", "approved-in"],
      ["material-assignment", "assignment-out", "assignment-frontend", "assignment-in"],
      ["material-assignment", "assignment-out", "consumption-tracking", "assignment-in"],
      ["material-assignment", "assignment-out", "return-management", "assignment-in"],
      ["consumption-tracking", "consumption-out", "analytics-dashboard", "metric-in"],
      ["return-management", "return-out", "analytics-dashboard", "metric-in"],
      ["pcb-repair", "repair-out", "analytics-dashboard", "metric-in"],
    ],
    staffRole: "dispatcher",
    settings: { inventory: { lowStockThreshold: 25 }, approval: { slaHours: 8, reminderHours: 2 } },
  },
];

const PAGE: Partial<Record<ModuleType, { id: string; title: string; layout: string }>> = {
  "dashboard-shell": { id: "dashboard", title: "Dashboard", layout: "dashboard" },
  "user-management": { id: "users", title: "Users", layout: "data-table" },
  inventory: { id: "inventory", title: "Inventory", layout: "data-table" },
  request: { id: "requests", title: "Requests", layout: "kanban" },
  approval: { id: "approvals", title: "Approvals", layout: "data-table" },
  "material-assignment": { id: "assignments", title: "Assignments", layout: "split-workspace" },
  "assignment-frontend": { id: "workbench", title: "Workbench", layout: "split-workspace" },
  "consumption-tracking": { id: "consumption", title: "Consumption", layout: "data-table" },
  "return-management": { id: "returns", title: "Returns", layout: "data-table" },
  "pcb-repair": { id: "repairs", title: "PCB Repair", layout: "kanban" },
  "analytics-dashboard": { id: "analytics", title: "Analytics", layout: "dashboard" },
  "reports-excel": { id: "reports", title: "Reports", layout: "data-table" },
};

const ROLE_NAMES: Record<string, string> = { storekeeper: "Storekeeper", technician: "Technician", dispatcher: "Dispatcher" };
/** What the operational role may do, before filtering to the modules a template enables. */
const STAFF_VERBS = ["view", "create", "record", "update", "process", "manage"];

const COL_W = 330;
const ROW_H = 190;

/** Modules the dashboard shell hosts directly: their only input is the shell's navigation. */
const SHELL_ENTRY: ModuleType[] = ["inventory", "pcb-repair"];

/**
 * The template's business wiring plus the platform spine, so the whole graph is one flow:
 * Auth → Dashboard (and Users), Dashboard → every entry module, and onward from there.
 */
function platformWires(types: ModuleType[], business: Wire[]): Wire[] {
  return [
    ["auth-rbac", "identity-out", "dashboard-shell", "identity-in"],
    ...(types.includes("user-management") ? [["auth-rbac", "identity-out", "user-management", "identity-in"] as Wire] : []),
    ...SHELL_ENTRY.filter((t) => types.includes(t)).map((t): Wire => ["dashboard-shell", "navigation-out", t, "shell-in"]),
    ...business,
  ];
}

/** Columns follow the wiring left to right: platform modules first, then each module after its sources. */
function layout(types: ModuleType[], wires: Wire[]): Map<ModuleType, { x: number; y: number }> {
  const depth = new Map<ModuleType, number>(types.map((t) => [t, 0]));
  for (let pass = 0; pass < types.length; pass++) {
    for (const [from, , to] of wires) if (depth.has(from) && (depth.get(to) ?? 0) <= depth.get(from)!) depth.set(to, depth.get(from)! + 1);
  }
  const rows = new Map<number, number>();
  const out = new Map<ModuleType, { x: number; y: number }>();
  for (const t of types) {
    const col = depth.get(t) ?? 2;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    out.set(t, { x: col * COL_W, y: row * ROW_H });
  }
  return out;
}

/** Builds a complete, compilable configuration (without identity) for a template. */
function buildConfiguration(d: TemplateDef, theme: WebsiteTheme): Record<string, unknown> {
  const types: ModuleType[] = ["auth-rbac", "dashboard-shell", ...d.modules];
  const pos = layout(types, platformWires(types, d.wires));
  const defs = types.map((t) => getModuleDefinition(t)!);

  const wires = platformWires(types, d.wires);
  const nodes = defs.map((def) => ({ id: def.type, moduleType: def.type, position: pos.get(def.type)!, config: { ...def.defaults, ...(d.settings?.[def.type] ?? {}) } }));
  const edges = wires.map(([s, sp, t, tp]) => ({ id: `${s}.${sp}->${t}.${tp}`, sourceNodeId: s, sourcePortId: sp, targetNodeId: t, targetPortId: tp }));

  const all = [...new Set(defs.flatMap((def) => def.permissions))];
  const pages = defs.flatMap((def) => {
    const pg = PAGE[def.type];
    if (!pg) return [];
    const view = def.permissions.find((p) => p.endsWith(":view"));
    return [{ id: pg.id, title: pg.title, path: pg.id, nodeId: def.type, layoutId: pg.layout, ...(view ? { requiredPermission: view } : {}) }];
  });
  const roles = [
    { id: "admin", name: "Administrator", permissions: all },
    { id: d.staffRole, name: ROLE_NAMES[d.staffRole] ?? d.staffRole, permissions: all.filter((p) => !p.startsWith("auth:") && !p.startsWith("users:") && STAFF_VERBS.includes(p.split(":")[1]!)) },
    { id: "viewer", name: "Viewer", permissions: all.filter((p) => p.endsWith(":view") && !p.startsWith("users:")) },
  ];

  const has = (t: ModuleType) => types.includes(t);
  const known = new Set(all);
  const transition = (from: string, to: string, permission?: string) => ({ from, to, ...(permission && known.has(permission) ? { permission } : {}) });
  const workflowDefinitions = [
    ...(has("request")
      ? [{
          id: "request-flow",
          initial: "draft",
          states: ["draft", "submitted", "approved", "rejected", "assigned", "fulfilled", "cancelled"],
          transitions: [
            transition("draft", "submitted", "request:create"),
            transition("submitted", "approved", "approval:decide"),
            transition("submitted", "rejected", "approval:decide"),
            transition("approved", "assigned", "assignment:create"),
            transition("assigned", "fulfilled"),
            transition("draft", "cancelled"),
            transition("submitted", "cancelled"),
          ],
        }]
      : []),
    ...(has("pcb-repair")
      ? [{
          id: "repair-flow",
          initial: "received",
          states: ["received", "diagnosing", "repairing", "testing", "completed", "scrapped"],
          transitions: [["received", "diagnosing"], ["diagnosing", "repairing"], ["diagnosing", "scrapped"], ["repairing", "testing"], ["testing", "completed"], ["testing", "repairing"]].map(([f, t]) => transition(f!, t!, "repair:update")),
        }]
      : []),
  ];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    shell: theme.shell,
    theme: { primary: theme.palette.primary, secondary: theme.palette.secondary },
    website: theme,
    layouts: ["dashboard", "data-table", "kanban", "split-workspace"].map((t) => ({ id: t, type: t })),
    modules: { nodes, edges },
    pages,
    navigation: pages.map((p) => ({ pageId: p.id, label: p.title })),
    roles,
    workflowDefinitions,
    calculatedFieldDefinitions: has("inventory") ? [{ id: "stock-shortfall", label: "Shortfall vs reorder level", expression: "max(reorderLevel - onHand, 0)", inputs: { reorderLevel: "number", onHand: "number" }, resultType: "number" }] : [],
    fields: has("inventory") ? [{ id: "item-price", entity: "inventory_item", key: "price", label: "Unit price", type: "number", required: false, hidden: false }] : [],
    customFields: [],
    reports: {},
    metadata: { description: `${d.name} website template` },
  };
}

/** A configuration dressed in a theme. Identity is left out; provisioning injects it. */
export function themedConfiguration(template: Record<string, unknown>, theme: WebsiteTheme): Record<string, unknown> {
  return { ...template, shell: theme.shell, theme: { primary: theme.palette.primary, secondary: theme.palette.secondary }, website: theme };
}

let cache: WebsiteTemplate[] | null = null;

export function listWebsiteTemplates(): WebsiteTemplate[] {
  cache ??= TEMPLATE_DEFS.flatMap((d) => {
    const theme = getWebsiteTheme(d.themeId);
    if (!theme) return [];
    const configuration = buildConfiguration(d, theme);
    const modules = d.modules.map((t) => getModuleDefinition(t)).filter((def) => def && !def.platformModule).map((def) => def!.displayName);
    return [{ id: d.id, name: d.name, tagline: d.tagline, description: d.description, presetId: d.presetId, theme, modules, moduleCount: d.modules.length + 2, configuration }];
  });
  return cache;
}

export const getWebsiteTemplate = (id: string): WebsiteTemplate | undefined => listWebsiteTemplates().find((t) => t.id === id);
