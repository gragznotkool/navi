import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession, RequestRecord, SiteConfiguration } from "@opshub/contracts";
import { ApprovalsModule } from "../src/features/approvals/ApprovalsModule";
import { RequestsModule } from "../src/features/requests/RequestsModule";
import { HubPage } from "../src/features/hub/HubPage";
import { useSession } from "../src/stores/session";
import { allPermissions, configs, renderInSite } from "./helpers";

vi.mock("../src/services", () => ({
  opsApi: {
    requests: vi.fn(),
    decide: vi.fn(),
    hubOverview: vi.fn().mockResolvedValue({
      sites: [],
      totals: { sites: 0, inventoryItems: 0, stockUnits: 0, pendingRequests: 0, pendingApprovals: 0, outstandingAssignments: 0 },
    }),
  },
  sitesApi: { list: vi.fn() },
  authApi: { logout: vi.fn(), login: vi.fn(), me: vi.fn() },
}));
import { opsApi, sitesApi } from "../src/services";

const withSla = (seconds: number | undefined): SiteConfiguration => {
  const cfg = JSON.parse(JSON.stringify(configs.distribution)) as SiteConfiguration;
  const node = cfg.modules.nodes.find((n) => n.moduleType === "approval")!;
  node.config = seconds === undefined ? {} : { slaSeconds: seconds };
  return cfg;
};
const req = (id: string, status: string, ageSeconds: number): RequestRecord =>
  ({ id, siteId: "s", status, lines: [{ itemId: "i", itemName: "Cable", quantity: 2 }], releaseVersion: 1, createdAt: "2026-01-01T10:00:00.000Z", statusChangedAt: "2026-01-01T10:00:00.000Z", ageSeconds }) as unknown as RequestRecord;

/** Lets the mocked API promises resolve without moving the fake clock. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

const pageOf = (cfg: SiteConfiguration, type: string) => {
  const page = cfg.pages.find((p) => cfg.modules.nodes.find((n) => n.id === p.nodeId)?.moduleType === type)!;
  return { page, node: cfg.modules.nodes.find((n) => n.id === page.nodeId)! };
};

describe("SLA ring in the approval queue and the request list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
    vi.mocked(opsApi.requests).mockResolvedValue({
      items: [req("11111111-1111-4111-8111-111111111111", "submitted", 0), req("22222222-2222-4222-8222-222222222222", "approved", 500)],
      total: 2,
    } as never);
  });
  afterEach(() => vi.useRealTimers());

  it("a pending request counts down on its own and turns overdue; a decided one never shows a ring", async () => {
    const cfg = withSla(10);
    renderInSite(<ApprovalsModule {...pageOf(cfg, "approval")} layout={undefined as never} />, { config: cfg, permissions: allPermissions(cfg) });
    await settle();
    expect(screen.getByText("10s left")).toBeInTheDocument();
    await act(async () => void vi.advanceTimersByTime(4000));
    expect(screen.getByText("6s left")).toBeInTheDocument();
    await act(async () => void vi.advanceTimersByTime(7000));
    expect(screen.getByText("Overdue by 1s")).toBeInTheDocument();
    expect(document.querySelector("[data-sla='breached']")).not.toBeNull();
    expect(document.querySelectorAll("[data-sla]")).toHaveLength(1); // only the submitted row
    expect(screen.getByRole("columnheader", { name: "Deadline" })).toBeInTheDocument();
  });

  it("shows no deadline column when the site has no SLA configured", async () => {
    const cfg = withSla(undefined);
    renderInSite(<ApprovalsModule {...pageOf(cfg, "approval")} layout={undefined as never} />, { config: cfg, permissions: allPermissions(cfg) });
    await settle();
    expect(screen.getByText("Approval queue")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Deadline" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-sla]")).toBeNull();
  });

  it("the requests list shows the same ring for submitted requests", async () => {
    const cfg = withSla(10);
    renderInSite(<RequestsModule {...pageOf(cfg, "request")} layout="data-table" />, { config: cfg, permissions: allPermissions(cfg) });
    await settle();
    expect(screen.getByText("10s left")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-sla]")).toHaveLength(1);
  });
});

describe("hub routes", () => {
  const session = (manage: boolean): AuthSession => ({
    user: { id: "10000000-0000-4000-8000-000000000001", email: "a@opshub.local", displayName: "A", isPlatformAdmin: false },
    memberships: [
      { siteId: "10000000-0000-4000-8000-0000000000a1", siteSlug: "central-stores", roles: ["admin"], permissions: manage ? ["config:manage"] : ["inventory:view"] },
      { siteId: "10000000-0000-4000-8000-0000000000a2", siteSlug: "distribution", roles: ["viewer"], permissions: ["inventory:view"] },
    ],
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  const sites = [
    { id: "10000000-0000-4000-8000-0000000000a1", slug: "central-stores", name: "Central Stores", shell: "sidebar", accent: "#111", activeReleaseVersion: 2 },
    { id: "10000000-0000-4000-8000-0000000000a2", slug: "distribution", name: "Distribution", shell: "topbar", accent: "#222", activeReleaseVersion: 1 },
  ];
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(sitesApi.list).mockResolvedValue(sites as never);
  });
  const mount = (view: "sites" | "builder", manage = true) => {
    useSession.setState({ status: "authenticated", session: session(manage) });
    return render(
      <MemoryRouter>
        <HubPage view={view} />
      </MemoryRouter>,
    );
  };

  it("the sites view lists every site and links into /s/:slug", async () => {
    mount("sites");
    expect(await screen.findByRole("link", { name: /Central Stores/ })).toHaveAttribute("href", "/s/central-stores");
    expect(screen.getByRole("link", { name: /Distribution/ })).toHaveAttribute("href", "/s/distribution");
    expect(screen.getByRole("link", { name: "Builder" })).toHaveAttribute("href", "/hub/builder");
  });

  it("the builder view lists only sites the user can configure, with builder, releases and rewind links", async () => {
    mount("builder");
    expect(await screen.findByRole("heading", { name: "Configuration builder" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Sites you can configure" });
    expect(list).toHaveTextContent("Central Stores");
    expect(list).not.toHaveTextContent("Distribution");
    expect(screen.getByRole("link", { name: /Open builder/ })).toHaveAttribute("href", "/s/central-stores/admin/builder");
    expect(screen.getByRole("link", { name: /Releases/ })).toHaveAttribute("href", "/s/central-stores/admin/releases");
    expect(screen.getByRole("link", { name: /Rewind/ })).toHaveAttribute("href", "/s/central-stores/admin/rewind");
  });

  it("the builder view says so plainly when the user can configure nothing", async () => {
    mount("builder", false);
    await waitFor(() => expect(screen.getByText("No sites you can configure")).toBeInTheDocument());
  });
});
