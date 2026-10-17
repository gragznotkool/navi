import { describe, expect, it } from "vitest";
import type { SiteConfiguration } from "@opshub/contracts";
import { compileConfiguration } from "../../api/src/compiler/compile";
import { dataTypes, moduleDefinitions } from "../../api/src/modules/registry";
import { addCustomField, canConnect, explainConnection, isolationProblem, removeModule, setRolePermission } from "../src/features/builder/configOps";
import { checkpoint, commit, createHistory, redo, replace, undo } from "../src/features/builder/history";
import { PRESETS, applyPreset } from "../src/features/builder/presets";
import { configs } from "./helpers";

const registry = [...moduleDefinitions];
const types = dataTypes.map((d) => ({ id: d.id, assignableTo: [...d.assignableTo] }));

/** Mirrors the "Circuit Breaker" demo: the builder refuses what the compiler would also refuse. */
describe("typed connections explain themselves", () => {
  const base = applyPreset(configs.central, PRESETS.find((p) => p.id === "approval-chain")!, registry).config;

  it("refuses analytics-style data feeding a Request input, naming the reason", () => {
    const withAnalytics = applyPreset(base, { ...PRESETS[0]!, modules: [{ type: "analytics-dashboard", col: 0, row: 3 }], wires: [] }, registry).config;
    const reason = explainConnection(registry, types, { sourceNodeId: "analytics-dashboard", sourcePortId: "metric-in", targetNodeId: "request", targetPortId: "request-out" }, withAnalytics);
    expect(reason).toMatch(/Direction/);
    const reason2 = explainConnection(registry, types, { sourceNodeId: "inventory", sourcePortId: "stock-out", targetNodeId: "approval", targetPortId: "request-in" }, base);
    expect(reason2).toBe("Incompatible Port: Approval module requires a Requests input stream, but Inventory outputs Stock items.");
  });

  it("refuses inventory feeding a returns pipeline and self/circular wiring", () => {
    const withReturns = applyPreset(base, PRESETS.find((p) => p.id === "repair-shop")!, registry).config;
    expect(explainConnection(registry, types, { sourceNodeId: "inventory", sourcePortId: "stock-out", targetNodeId: "return-management", targetPortId: "assignment-in" }, withReturns)).toMatch(/Incompatible Port: Return Management/);
    expect(explainConnection(registry, types, { sourceNodeId: "request", sourcePortId: "request-out", targetNodeId: "request", targetPortId: "stock-in" }, withReturns)).toMatch(/Self-connection/);
  });

  it("accepts the typed wiring and keeps canConnect consistent", () => {
    expect(canConnect(registry, types, { sourceNodeId: "approval", sourcePortId: "approved-out", targetNodeId: "material-assignment", targetPortId: "approved-in" }, base)).toBe(true);
    // approved-request is assignable to request
    expect(canConnect(registry, types, { sourceNodeId: "approval", sourcePortId: "approved-out", targetNodeId: "approval", targetPortId: "request-in" }, base)).toBe(false);
  });

  it("flags an Approval dropped alone, with and without its dependency", () => {
    const approvalDef = registry.find((d) => d.type === "approval")!;
    const noRequest = { ...configs.distribution, modules: { ...configs.distribution.modules, nodes: configs.distribution.modules.nodes.filter((n) => n.moduleType !== "approval") } } as SiteConfiguration;
    const alone = JSON.parse(JSON.stringify(noRequest)) as SiteConfiguration;
    alone.modules.nodes.push({ id: "approval", moduleType: approvalDef.type, position: { x: 0, y: 0 }, config: {} });
    alone.modules.edges = alone.modules.edges.filter((e) => e.targetNodeId !== "approval");
    alone.modules.nodes = alone.modules.nodes.filter((n) => n.id === "approval" || n.id !== "request");
    expect(isolationProblem(registry, alone, "approval")).toMatch(/needs Request/);
    expect(isolationProblem(registry, base, "approval")).toBeNull();
  });
});

describe("starter presets", () => {
  for (const preset of PRESETS) {
    for (const [name, cfg] of Object.entries(configs)) {
      it(`${preset.name} yields a configuration the server compiler accepts on ${name}`, () => {
        const { config, newEdgeIds } = applyPreset(cfg, preset, registry);
        const out = compileConfiguration(config);
        expect(out.result.errors).toEqual([]);
        expect(out.result.warnings.filter((w) => w.code === "ports.isolated-module")).toEqual([]);
        expect(newEdgeIds.length).toBeGreaterThan(0);
        for (const m of preset.modules) expect(config.modules.nodes.some((n) => n.moduleType === m.type)).toBe(true);
      });
    }
  }

  it("is idempotent: applying twice creates no duplicate nodes or edges", () => {
    const preset = PRESETS[1]!;
    const once = applyPreset(configs.distribution, preset, registry).config;
    const twice = applyPreset(once, preset, registry);
    expect(twice.newEdgeIds).toEqual([]);
    expect(twice.config.modules.nodes.length).toBe(once.modules.nodes.length);
  });
});

describe("inspector edits", () => {
  it("toggles role permissions, adds custom fields and drops them with their module", () => {
    const granted = setRolePermission(configs.central, "viewer", "inventory:manage", true);
    expect(granted.roles.find((r) => r.id === "viewer")!.permissions).toContain("inventory:manage");
    expect(setRolePermission(granted, "viewer", "inventory:manage", false).roles.find((r) => r.id === "viewer")!.permissions).not.toContain("inventory:manage");

    const withField = addCustomField({ ...configs.central, customFields: [] }, "inventory");
    expect(withField.customFields).toEqual([{ id: "inventory.field1", nodeId: "inventory", name: "field1", type: "string", required: false }]);
    expect(compileConfiguration(withField).result.errors).toEqual([]);
    expect(removeModule(withField, "inventory", registry).customFields).toEqual([]);
  });

  it("the compiler rejects a custom field on a missing node", () => {
    const bad = { ...configs.central, customFields: [{ id: "x", nodeId: "ghost", name: "a", type: "string", required: false }] } as SiteConfiguration;
    expect(compileConfiguration(bad).result.errors.map((e) => e.code)).toContain("fields.missing-node");
  });
});

describe("undo / redo history", () => {
  it("walks back and forth through commits and clears redo on a new edit", () => {
    let h = createHistory("a");
    h = commit(h, "b");
    h = commit(h, "c");
    expect(undo(undo(h)).present).toBe("a");
    expect(redo(undo(h)).present).toBe("c");
    expect(commit(undo(h), "d").future).toEqual([]);
    expect(undo(createHistory("only")).present).toBe("only");
  });

  it("a drag is ONE undo step: checkpoint, then many in-flight replacements", () => {
    let h = createHistory({ x: 0 });
    h = checkpoint(h);
    for (const x of [1, 2, 3, 4]) h = replace(h, { x });
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toEqual({ x: 0 });
    expect(redo(undo(h)).present).toEqual({ x: 4 });
  });
});
