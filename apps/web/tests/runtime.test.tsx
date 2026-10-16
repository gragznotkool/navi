import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDefinition, SiteConfiguration } from "@opshub/contracts";
import { ApiRequestError } from "../src/lib/api";
import { SiteShell } from "../src/runtime/SiteShell";
import { UniversalRenderer } from "../src/runtime/UniversalRenderer";
import { allPermissions, configs, renderInSite } from "./helpers";

vi.mock("../src/services", () => ({
  opsApi: { items: vi.fn(), requests: vi.fn(), assignments: vi.fn() },
  sitesApi: { modules: vi.fn().mockResolvedValue([]) },
  reportsApi: { list: vi.fn().mockResolvedValue([]) },
}));
import { opsApi, reportsApi } from "../src/services";

const item = { id: "i1", siteId: "s", sku: "BRG-1", name: "Bearing", unit: "each", onHand: 4, reorderLevel: 10, updatedAt: "2026-01-01T00:00:00.000Z" };
const pageFor = (c: SiteConfiguration, path: string): PageDefinition => c.pages.find((p) => p.path === path)!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(reportsApi.list).mockResolvedValue([]);
});

describe("UniversalRenderer", () => {
  it("renders a module from configuration through the registry", async () => {
    vi.mocked(opsApi.items).mockResolvedValue({ items: [item], page: 1, pageSize: 50, total: 1 });
    renderInSite(<UniversalRenderer page={pageFor(configs.central, "inventory")} />, { config: configs.central, permissions: allPermissions(configs.central) });
    expect(await screen.findByText("BRG-1")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument(); // 4 <= reorder level 10
  });

  it("renders the same module for a different site with no site-specific code", async () => {
    vi.mocked(opsApi.requests).mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });
    renderInSite(<UniversalRenderer page={pageFor(configs.service, "requests")} />, { config: configs.service, permissions: allPermissions(configs.service) });
    expect(await screen.findByText("No requests yet")).toBeInTheDocument();
  });

  it("uses the configured layout: kanban shows status columns", async () => {
    vi.mocked(opsApi.requests).mockResolvedValue({
      items: [{ id: "abcdef12-0000-4000-8000-000000000000", siteId: "s", itemId: "i", quantity: 2, status: "submitted", requestedBy: "u", releaseVersion: 1, createdAt: "2026-01-01T00:00:00.000Z" }],
      page: 1, pageSize: 100, total: 1,
    });
    renderInSite(<UniversalRenderer page={pageFor(configs.service, "requests")} />, { config: configs.service, permissions: allPermissions(configs.service) });
    expect(await screen.findByRole("region", { name: "submitted (1)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "fulfilled (0)" })).toBeInTheDocument();
  });

  it("shows a fallback for an unsupported module type instead of crashing", () => {
    const cfg = JSON.parse(JSON.stringify(configs.central)) as SiteConfiguration;
    (cfg.modules.nodes.find((n) => n.id === "inventory") as { moduleType: string }).moduleType = "teleporter";
    renderInSite(<UniversalRenderer page={pageFor(cfg, "inventory")} />, { config: cfg, permissions: allPermissions(cfg) });
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported module");
  });

  it("shows invalid-configuration errors for dangling references", () => {
    const cfg = JSON.parse(JSON.stringify(configs.central)) as SiteConfiguration;
    cfg.pages.find((p) => p.path === "inventory")!.layoutId = "ghost";
    renderInSite(<UniversalRenderer page={pageFor(cfg, "inventory")} />, { config: cfg, permissions: allPermissions(cfg) });
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid page configuration");
  });

  it("enforces role-based visibility", () => {
    renderInSite(<UniversalRenderer page={pageFor(configs.central, "inventory")} />, { config: configs.central, permissions: ["dashboard:view"] });
    expect(screen.getByRole("alert")).toHaveTextContent("Access restricted");
    expect(opsApi.items).not.toHaveBeenCalled();
  });

  it("explains modules that are enabled but not implemented", () => {
    renderInSite(<UniversalRenderer page={pageFor(configs.service, "pcb-repair")} />, { config: configs.service, permissions: allPermissions(configs.service) });
    expect(screen.getByRole("status")).toHaveTextContent("Not implemented yet");
  });
});

describe("loading, empty and error states", () => {
  const page = () => pageFor(configs.central, "inventory");
  const opts = () => ({ config: configs.central, permissions: allPermissions(configs.central) });

  it("shows loading, then empty", async () => {
    vi.mocked(opsApi.items).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
    renderInSite(<UniversalRenderer page={page()} />, opts());
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("No inventory items")).toBeInTheDocument();
  });

  it("shows API errors without fabricating data", async () => {
    vi.mocked(opsApi.items).mockRejectedValue(new ApiRequestError(500, "internal_error", "An unexpected error occurred"));
    renderInSite(<UniversalRenderer page={page()} />, opts());
    expect(await screen.findByText("An unexpected error occurred")).toBeInTheDocument();
    expect(screen.queryByText("BRG-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows 501 as 'not available yet', not as a failure", async () => {
    vi.mocked(opsApi.items).mockRejectedValue(new ApiRequestError(501, "not_implemented", "Analytics is not implemented yet"));
    renderInSite(<UniversalRenderer page={page()} />, opts());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not available yet"));
  });
});

describe("SiteShell", () => {
  const shellOf = (cfg: SiteConfiguration, permissions: string[]) =>
    renderInSite(<SiteShell title="Test"><p>content</p></SiteShell>, { config: cfg, permissions });

  it("hides navigation entries the role cannot open", () => {
    shellOf(configs.service, ["dashboard:view", "request:view"]);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveTextContent("Requests");
    expect(nav).not.toHaveTextContent("Approvals");
    expect(nav).not.toHaveTextContent("PCB Repair");
  });

  it("shows platform administration links only with config:manage", () => {
    const { unmount } = shellOf(configs.central, ["dashboard:view"]);
    expect(screen.queryByText("Configuration builder")).not.toBeInTheDocument();
    unmount();
    shellOf(configs.central, ["dashboard:view", "config:manage"]);
    expect(screen.getByText("Configuration builder")).toBeInTheDocument();
  });

  it("chooses the shell from configuration: sidebar vs topbar vs workbench", () => {
    const sidebar = shellOf(configs.central, ["dashboard:view"]);
    expect(sidebar.container.querySelector("aside")).not.toBeNull();
    sidebar.unmount();
    const top = shellOf(configs.service, ["dashboard:view"]);
    expect(top.container.querySelector("aside")).toBeNull();
    expect(top.container.querySelector("header")).not.toBeNull();
    top.unmount();
    const bench = shellOf(configs.distribution, ["dashboard:view"]);
    expect(bench.container.querySelector("header.bg-slate-900")).not.toBeNull();
  });

  it("applies the site's theme tokens", () => {
    const { container } = shellOf(configs.central, ["dashboard:view"]);
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--accent")).toBe("#0F766E");
  });
});
