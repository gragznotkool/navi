import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { siteConfigurationSchema, type SiteConfiguration } from "@opshub/contracts";
import { generateProposalPayload, calculateProposalDiff, hashConfiguration } from "../../src/services/aiProposalEngine.js";

const load = (slug: string): SiteConfiguration =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../config/sites/${slug}.json`), "utf8")) as SiteConfiguration;

describe("aiProposalEngine (Bolo & Build)", () => {
  const baseConfig = load("distribution");

  it("generates structured proposal for returns workflow requirement", async () => {
    const prompt =
      "In the Distribution site, enable a Returns workflow. Allow authorized store managers to create return requests, require supervisor approval, record the item, quantity, return reason, and status, and restrict approval to authorized supervisors.";

    const result = await generateProposalPayload(baseConfig, prompt);

    expect(result.title).toBeDefined();
    expect(result.summary.toLowerCase()).toContain("return");

    // Proposed configuration is valid against schema
    const parseRes = siteConfigurationSchema.safeParse(result.proposedConfiguration);
    if (!parseRes.success) {
      console.error(JSON.stringify(parseRes.error.format(), null, 2));
    }
    expect(parseRes.success).toBe(true);

    // Modules were enabled in proposedConfiguration
    const nodeTypes = result.proposedConfiguration.modules.nodes.map((n) => n.moduleType);
    expect(nodeTypes).toContain("return-management");
    expect(nodeTypes).toContain("approval");

    // Roles and custom fields added
    const roleIds = result.proposedConfiguration.roles.map((r) => r.id);
    expect(roleIds).toContain("store-manager");
    expect(roleIds).toContain("supervisor");

    // Changes list
    expect(result.changes.length).toBeGreaterThan(0);

    // AI Explanation
    expect(result.aiExplanation.whatChanges).toBeDefined();
    expect(result.aiExplanation.whyItAddressesPrompt).toBeDefined();

    const hash = hashConfiguration(result.proposedConfiguration);
    expect(hash).toHaveLength(64);
  });

  it("detects configuration diff between base and modified config", () => {
    const nextConfig = JSON.parse(JSON.stringify(baseConfig));
    nextConfig.modules.nodes.push({
      id: "node-pcb",
      moduleType: "pcb-repair",
      name: "PCB Repair",
      config: {},
    });

    const { diffSummary, changes } = calculateProposalDiff(baseConfig, nextConfig);
    expect(diffSummary.modulesAdded).toContain("pcb-repair");
    expect(changes.some((c) => c.operation === "add")).toBe(true);
  });
});
