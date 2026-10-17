import { describe, expect, it } from "vitest";
import type { SiteConfiguration } from "@opshub/contracts";
import { compileConfiguration } from "../../src/compiler/compile.js";
import { listWebsiteTemplates } from "../../src/websites/templates.js";

const identity = { siteId: "00000000-0000-4000-8000-0000000000aa", slug: "template-check", name: "Template check" };

describe("website templates", () => {
  const templates = listWebsiteTemplates();

  it("compiles every template with no errors and no isolated modules", () => {
    expect(templates).toHaveLength(6);
    for (const t of templates) {
      const { result } = compileConfiguration({ ...(t.configuration as object), ...identity });
      expect(result.errors, t.id).toEqual([]);
      expect(result.warnings.filter((w) => w.code === "ports.isolated-module"), t.id).toEqual([]);
    }
  });

  it("connects every module end to end: each one is reachable from Auth by following the wiring", () => {
    for (const t of templates) {
      const cfg = t.configuration as SiteConfiguration;
      const next = new Map<string, string[]>();
      for (const e of cfg.modules.edges) next.set(e.sourceNodeId, [...(next.get(e.sourceNodeId) ?? []), e.targetNodeId]);
      const seen = new Set<string>();
      const stack = ["auth-rbac"];
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(...(next.get(n) ?? []));
      }
      expect(cfg.modules.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id), t.id).toEqual([]);
    }
  });

  it("gives each template its own module graph", () => {
    const shapes = templates.map((t) => {
      const cfg = t.configuration as SiteConfiguration;
      return cfg.modules.edges.map((e) => e.id).sort().join("|");
    });
    expect(new Set(shapes).size).toBe(templates.length);
  });
});
