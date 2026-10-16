import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SiteConfiguration } from "@opshub/contracts";
import { compileConfiguration, hasCycle } from "../../src/compiler/compile.js";
import { checkExpression } from "../../src/compiler/expression.js";
import { getModuleDefinition, isCompatible, moduleDefinitions } from "../../src/modules/registry.js";

const load = (slug: string): SiteConfiguration =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../config/sites/${slug}.json`), "utf8")) as SiteConfiguration;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const codes = (input: unknown) => compileConfiguration(input).result.errors.map((e) => e.code);

describe("seed site configurations", () => {
  it.each(["central-stores", "service-centre", "distribution"])("%s compiles without errors", (slug) => {
    const out = compileConfiguration(load(slug));
    expect(out.result.errors).toEqual([]);
    expect(out.compiled?.slug).toBe(slug);
  });

  it("distribution does not include return-management initially", () => {
    expect(load("distribution").modules.nodes.some((n) => n.moduleType === "return-management")).toBe(false);
  });

  it("enabling return-management on distribution is valid with the same pipeline (no site special-casing)", () => {
    const cfg = clone(load("distribution"));
    cfg.modules.nodes.push({ id: "return-management", moduleType: "return-management", position: { x: 0, y: 0 }, config: {} });
    cfg.modules.edges.push({
      id: "assignment-to-returns",
      sourceNodeId: "material-assignment",
      sourcePortId: "assignment-out",
      targetNodeId: "return-management",
      targetPortId: "assignment-in",
    });
    cfg.pages.push({ id: "returns", title: "Returns", path: "returns", nodeId: "return-management", layoutId: "data-table", requiredPermission: "return:view" });
    cfg.navigation.push({ pageId: "returns", label: "Returns" });
    expect(compileConfiguration(cfg).result.errors).toEqual([]);
  });
});

describe("registry", () => {
  it("defines 13 modules and exactly two platform modules", () => {
    expect(moduleDefinitions).toHaveLength(13);
    expect(moduleDefinitions.filter((m) => m.platformModule).map((m) => m.type).sort()).toEqual(["auth-rbac", "dashboard-shell"]);
  });
  it("resolves known and rejects unknown module types", () => {
    expect(getModuleDefinition("inventory")?.displayName).toBe("Inventory");
    expect(getModuleDefinition("nope")).toBeUndefined();
  });
  it("port compatibility: same type and explicit assignability only", () => {
    expect(isCompatible("request", "request")).toBe(true);
    expect(isCompatible("approved-request", "request")).toBe(true);
    expect(isCompatible("request", "approved-request")).toBe(false);
    expect(isCompatible("stock-item", "assignment")).toBe(false);
  });
});

describe("compiler rejections", () => {
  it("rejects non-object input and unsupported versions with actionable errors", () => {
    expect(codes("x")).toContain("schema.not-object");
    expect(codes({ ...load("central-stores"), schemaVersion: 99 })).toContain("schema.version-too-new");
    expect(codes({ ...load("central-stores"), schemaVersion: 0 })).toContain("schema.version-unsupported");
  });

  it("rejects schema violations without repairing them", () => {
    const cfg = clone(load("central-stores"));
    cfg.theme.primary = "teal";
    expect(codes(cfg)).toContain("schema.invalid");
  });

  it("rejects unknown module types", () => {
    const cfg = clone(load("central-stores")) as unknown as { modules: { nodes: { moduleType: string }[] } };
    cfg.modules.nodes[2]!.moduleType = "teleporter";
    expect(codes(cfg)).toContain("schema.invalid");
  });

  it("rejects removal of a platform module", () => {
    const cfg = clone(load("central-stores"));
    cfg.modules.nodes = cfg.modules.nodes.filter((n) => n.moduleType !== "auth-rbac");
    cfg.modules.edges = cfg.modules.edges.filter((e) => e.sourceNodeId !== "auth-rbac");
    expect(codes(cfg)).toContain("dependencies.platform-required");
  });

  it("rejects missing dependencies", () => {
    const cfg = clone(load("service-centre"));
    cfg.modules.nodes = cfg.modules.nodes.filter((n) => n.moduleType !== "request");
    expect(codes(cfg)).toContain("dependencies.missing");
  });

  it("rejects duplicate node and edge ids", () => {
    const cfg = clone(load("central-stores"));
    cfg.modules.nodes.push({ ...cfg.modules.nodes[0]! });
    cfg.modules.edges.push({ ...cfg.modules.edges[0]! });
    const c = codes(cfg);
    expect(c).toContain("graph.duplicate-node");
    expect(c).toContain("graph.duplicate-edge");
  });

  it("rejects edges to missing nodes, bad ports and incompatible data types", () => {
    const base = clone(load("distribution"));
    const missing = clone(base);
    missing.modules.edges.push({ id: "x", sourceNodeId: "ghost", sourcePortId: "a", targetNodeId: "approval", targetPortId: "request-in" });
    expect(codes(missing)).toContain("graph.missing-node");

    const badPort = clone(base);
    badPort.modules.edges.push({ id: "y", sourceNodeId: "request", sourcePortId: "nope", targetNodeId: "approval", targetPortId: "request-in" });
    expect(codes(badPort)).toContain("ports.invalid-source");

    const incompatible = clone(base);
    incompatible.modules.edges.push({ id: "z", sourceNodeId: "request", sourcePortId: "request-out", targetNodeId: "material-assignment", targetPortId: "approved-in" });
    expect(codes(incompatible)).toContain("ports.incompatible");
  });

  it("detects cycles in directed graphs", () => {
    expect(hasCycle(new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]]]))).toBe(true);
    expect(hasCycle(new Map([["a", ["b", "c"]], ["b", ["c"]], ["c", []]]))).toBe(false);
    expect(hasCycle(new Map([["a", ["a"]]]))).toBe(true);
  });

  it("rejects bad page, layout, role and workflow references", () => {
    const cfg = clone(load("service-centre"));
    cfg.pages[1]!.layoutId = "ghost";
    cfg.pages[2]!.nodeId = "ghost";
    cfg.roles[1]!.permissions.push("inventory:view");
    cfg.workflowDefinitions[0]!.transitions.push({ from: "draft", to: "limbo" });
    const c = codes(cfg);
    expect(c).toContain("pages.missing-layout");
    expect(c).toContain("pages.missing-node");
    expect(c).toContain("roles.unknown-permission");
    expect(c).toContain("workflows.bad-transition");
  });

  it("returns no compiled output when blocking errors exist", () => {
    const cfg = clone(load("central-stores"));
    cfg.pages[1]!.layoutId = "ghost";
    const out = compileConfiguration(cfg);
    expect(out.result.valid).toBe(false);
    expect(out.compiled).toBeUndefined();
  });
});

describe("expression checker", () => {
  const inputs = { a: "number", b: "number", flag: "boolean" } as const;
  it("accepts typed arithmetic, comparison and allowed functions", () => {
    expect(checkExpression("max(a - b, 0)", inputs)).toMatchObject({ resultType: "number" });
    expect(checkExpression("a > b && flag", inputs)).toMatchObject({ resultType: "boolean" });
  });
  it.each([
    ["process.exit(1)", "expression.call"],
    ["constructor.constructor('x')()", "expression.call"],
    ["eval(a)", "expression.function"],
    ["a.b", "expression.syntax"],
    ["unknownVar + 1", "expression.unknown-input"],
    ["a + flag", "expression.type"],
    ["a ? 1 : 2", "expression.syntax"],
    ["max(a)", "expression.arity"],
  ])("rejects %s", (expr, code) => {
    expect(checkExpression(expr, inputs).issues.map((i) => i.code)).toContain(code);
  });
  it("reports parse errors", () => {
    expect(checkExpression("a +", inputs).issues[0]?.code).toBe("expression.parse");
  });
});
