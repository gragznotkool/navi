import type { ModuleDefinition, ModuleType, SiteConfiguration } from "@opshub/contracts";
import { addEdge, addModule, moveNode } from "./configOps";

type Wire = [fromModule: ModuleType, fromPort: string, toModule: ModuleType, toPort: string];

export interface Preset {
  id: string;
  name: string;
  description: string;
  modules: { type: ModuleType; col: number; row: number }[];
  wires: Wire[];
}

export const PRESETS: readonly Preset[] = [
  {
    id: "inventory-starter",
    name: "Inventory Starter",
    description: "Inventory feeding Requests and Excel reports",
    modules: [
      { type: "inventory", col: 0, row: 0 },
      { type: "request", col: 1, row: 0 },
      { type: "reports-excel", col: 1, row: 1 },
    ],
    wires: [
      ["inventory", "stock-out", "request", "stock-in"],
      ["inventory", "stock-out", "reports-excel", "stock-in"],
    ],
  },
  {
    id: "approval-chain",
    name: "Approval Chain",
    description: "Request → Approval → Material Assignment → Consumption",
    modules: [
      { type: "inventory", col: 0, row: 0 },
      { type: "request", col: 1, row: 0 },
      { type: "approval", col: 2, row: 0 },
      { type: "material-assignment", col: 3, row: 0 },
      { type: "consumption-tracking", col: 4, row: 0 },
    ],
    wires: [
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["approval", "approved-out", "material-assignment", "approved-in"],
      ["material-assignment", "assignment-out", "consumption-tracking", "assignment-in"],
    ],
  },
  {
    id: "repair-shop",
    name: "Repair Shop",
    description: "PCB Repair with parts flowing through Assignment, Consumption and Returns",
    modules: [
      { type: "pcb-repair", col: 0, row: 1 },
      { type: "inventory", col: 0, row: 0 },
      { type: "request", col: 1, row: 0 },
      { type: "approval", col: 2, row: 0 },
      { type: "material-assignment", col: 3, row: 0 },
      { type: "consumption-tracking", col: 4, row: 0 },
      { type: "return-management", col: 4, row: 1 },
    ],
    wires: [
      ["inventory", "stock-out", "request", "stock-in"],
      ["request", "request-out", "approval", "request-in"],
      ["approval", "approved-out", "material-assignment", "approved-in"],
      ["material-assignment", "assignment-out", "consumption-tracking", "assignment-in"],
      ["material-assignment", "assignment-out", "return-management", "assignment-in"],
    ],
  },
];

export interface PresetResult {
  config: SiteConfiguration;
  /** Edge ids created by this preset (for the green pulse). */
  newEdgeIds: string[];
}

/**
 * Adds any missing modules, snaps every preset module into a tidy grid below the existing graph,
 * and wires the typed edges. Existing nodes and edges are preserved.
 */
export function applyPreset(config: SiteConfiguration, preset: Preset, registry: readonly ModuleDefinition[]): PresetResult {
  const inPreset = new Set<string>(preset.modules.map((m) => m.type));
  const others = config.modules.nodes.filter((n) => !inPreset.has(n.moduleType));
  const originY = others.length > 0 ? Math.max(...others.map((n) => n.position.y)) + 210 : 0;
  let next = config;
  for (const m of preset.modules) {
    const def = registry.find((d) => d.type === m.type);
    if (!def) continue;
    const pos = { x: 40 + m.col * 300, y: originY + m.row * 190 };
    next = next.modules.nodes.some((n) => n.moduleType === m.type) ? moveNode(next, m.type, pos) : addModule(next, def, pos);
  }
  const before = new Set(next.modules.edges.map((e) => e.id));
  for (const [from, fromPort, to, toPort] of preset.wires) {
    next = addEdge(next, { sourceNodeId: from, sourcePortId: fromPort, targetNodeId: to, targetPortId: toPort });
  }
  return { config: next, newEdgeIds: next.modules.edges.map((e) => e.id).filter((id) => !before.has(id)) };
}
