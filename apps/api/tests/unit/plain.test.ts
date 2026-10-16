import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SiteConfiguration } from "@opshub/contracts";
import { describeChanges } from "../../src/releases/plain.js";

const load = (slug: string): SiteConfiguration =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../config/sites/${slug}.json`), "utf8")) as SiteConfiguration;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("describeChanges", () => {
  it("says nothing changed for identical configurations", () => {
    expect(describeChanges(load("distribution"), load("distribution"))).toEqual(["No changes."]);
  });

  it("is deterministic", () => {
    const a = load("distribution");
    const b = clone(a);
    b.name = "Renamed";
    expect(describeChanges(a, b)).toEqual(describeChanges(a, b));
  });

  it("describes adding the Returns module and its tab", () => {
    const a = load("distribution");
    const b = clone(a);
    b.modules.nodes.push({ id: "return-management", moduleType: "return-management", position: { x: 0, y: 0 }, config: {} });
    b.pages.push({ id: "returns", title: "Returns", path: "returns", nodeId: "return-management", layoutId: "data-table" });
    expect(describeChanges(a, b)).toEqual(expect.arrayContaining([expect.stringMatching(/module is added, with a new “Returns” tab/)]));
  });

  it("describes hiding a field with the number of rows that keep their values", () => {
    const a = load("central-stores");
    const b = clone(a);
    b.fields[0]!.hidden = true;
    const [sentence] = describeChanges(a, b, new Map([["inventory_item.price", 1]]));
    expect(sentence).toBe("The “Unit price” field is hidden on inventory items. 1 row keeps the saved value, and it comes back if the field is shown again.");
  });

  it("describes SLA deadline changes and role permission changes", () => {
    const a = load("distribution");
    const b = clone(a);
    b.modules.nodes.find((n) => n.moduleType === "approval")!.config["slaSeconds"] = 10;
    b.roles[0]!.permissions = b.roles[0]!.permissions.filter((p) => p !== "dashboard:view");
    const out = describeChanges(a, b).join(" ");
    expect(out).toMatch(/turn overdue after 10 seconds/);
    expect(out).toMatch(/role loses 1 permission: dashboard:view/);
  });
});
