import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEBSITE_THEMES, getWebsiteTheme, type AuthSession, type SiteConfiguration, type WebsiteTemplate } from "@opshub/contracts";
import { BuilderPage } from "../src/features/builder/BuilderPage";
import { WebsitePreview } from "../src/features/builder/website-builder/WebsitePreview";
import { WebsiteDeployPanel } from "../src/features/builder/website-builder/WebsiteDeployPanel";
import { WebsiteRoute } from "../src/runtime/WebsiteRenderer";
import { SiteRoute } from "../src/runtime/SiteRoutes";
import { SiteShell } from "../src/runtime/SiteShell";
import { useSession } from "../src/stores/session";
import { configs, renderInSite } from "./helpers";

vi.mock("../src/services", () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
  sitesApi: { modules: vi.fn(), dataTypes: vi.fn(), list: vi.fn(), config: vi.fn(), access: vi.fn() },
  configApi: { validate: vi.fn(), saveDraft: vi.fn(), preview: vi.fn(), draft: vi.fn(), discardDraft: vi.fn() },
  releasesApi: { publish: vi.fn(), impact: vi.fn() },
  provisioningApi: { snapshot: vi.fn() },
  opsApi: { items: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })), requests: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 100 })) },
  websiteApi: { host: vi.fn(), templates: vi.fn(), users: vi.fn(), deploy: vi.fn(), listDeployed: vi.fn(), access: vi.fn(), updateAccess: vi.fn() },
}));
import { configApi, provisioningApi, sitesApi, websiteApi } from "../src/services";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const SK = "10000000-0000-4000-8000-000000000002";
const session = (over: Partial<AuthSession["user"]> = {}, memberships: AuthSession["memberships"] = []): AuthSession => ({
  user: { id: ADMIN, email: "admin@opshub.local", displayName: "Platform Admin", isPlatformAdmin: true, ...over },
  memberships,
  expiresAt: "2030-01-01T00:00:00.000Z",
});

const ocean = getWebsiteTheme("ocean-breeze")!;
const { siteId: _s, slug: _g, name: _n, ...templateConfig } = configs.central;
const template: WebsiteTemplate = { id: "ocean-breeze", name: "Ocean Breeze", tagline: "Clean corporate", description: "Stores", presetId: "stores", theme: ocean, modules: ["Inventory"], moduleCount: configs.central.modules.nodes.length, configuration: { ...templateConfig, website: ocean } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor() {} });
  vi.stubGlobal("EventSource", undefined);
  vi.mocked(configApi.draft).mockResolvedValue(null);
  vi.mocked(sitesApi.modules).mockResolvedValue([]);
  vi.mocked(sitesApi.dataTypes).mockResolvedValue([]);
  vi.mocked(websiteApi.host).mockResolvedValue({ siteId: configs.central.siteId, slug: configs.central.slug });
  vi.mocked(websiteApi.templates).mockResolvedValue([template]);
  vi.mocked(websiteApi.listDeployed).mockResolvedValue([]);
  vi.mocked(websiteApi.users).mockResolvedValue([
    { id: ADMIN, email: "admin@opshub.local", displayName: "Platform Admin", isPlatformAdmin: true },
    { id: SK, email: "storekeeper@opshub.local", displayName: "Sam Storekeeper", isPlatformAdmin: false },
  ]);
  useSession.setState({ status: "authenticated", session: session(), restore: vi.fn(async () => undefined) });
});

describe("website builder in the configuration builder", () => {
  const mount = () => renderInSite(<BuilderPage activeVersion={1} activeConfig={configs.central} />, { config: configs.central, permissions: ["config:manage"] });

  it("is hidden from non-admins", async () => {
    useSession.setState({ session: session({ isPlatformAdmin: false }) });
    mount();
    await screen.findByText("Configuration builder");
    expect(screen.queryByRole("tab", { name: "Templates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Website builder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Deploy website" })).not.toBeInTheDocument();
    expect(websiteApi.templates).not.toHaveBeenCalled();
    expect(websiteApi.listDeployed).not.toHaveBeenCalled();
    expect(websiteApi.users).not.toHaveBeenCalled();
  });

  it("appears only in the host site's builder, even for an admin", async () => {
    renderInSite(<BuilderPage activeVersion={1} activeConfig={configs.service} />, { config: configs.service, permissions: ["config:manage"] });
    await screen.findByText("Configuration builder");
    await waitFor(() => expect(websiteApi.host).toHaveBeenCalled());
    expect(screen.queryByRole("complementary", { name: "Website builder" })).not.toBeInTheDocument();
    expect(websiteApi.templates).not.toHaveBeenCalled();
  });

  it("never renders the deploy panel for a non-admin, even if asked to", async () => {
    useSession.setState({ session: session({ isPlatformAdmin: false }) });
    render(<WebsiteDeployPanel templateId="ocean-breeze" templateName="Ocean Breeze" theme={ocean} onTheme={() => undefined} config={configs.central} onDeployed={() => undefined} />);
    expect(screen.queryByRole("region", { name: "Deploy website" })).not.toBeInTheDocument();
    expect(websiteApi.users).not.toHaveBeenCalled();
  });

  it("loads a template read-only, then deploys it and shows a copyable URL", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("template-ocean-breeze"));
    expect(await screen.findByText("Template structure is read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review & publish" })).not.toBeInTheDocument();

    const panel = screen.getByRole("region", { name: "Deploy website" });
    await userEvent.type(within(panel).getByPlaceholderText("e.g. Flipkart Stores"), "Flipkart Stores");
    expect(within(panel).getByLabelText("URL slug")).toHaveValue("flipkart-stores");
    await userEvent.click(await within(panel).findByLabelText("Sam Storekeeper"));
    await userEvent.click(within(panel).getByRole("radio", { name: "Coral Garden" }));

    vi.mocked(websiteApi.deploy).mockResolvedValue({ jobId: "20000000-0000-4000-8000-000000000001", slug: "flipkart-stores", path: "/w/flipkart-stores", created: true });
    vi.mocked(provisioningApi.snapshot).mockResolvedValue({
      job: { id: "20000000-0000-4000-8000-000000000001", slug: "flipkart-stores", name: "Flipkart Stores", preset: "stores", status: "succeeded", error: null, createdAt: "2026-01-01T00:00:00.000Z" },
      events: [{ seq: 1, level: "success", message: "Committed.", at: "2026-01-01T00:00:00.000Z" }],
    });
    await userEvent.click(within(panel).getByRole("button", { name: "Deploy" }));

    await waitFor(() => expect(websiteApi.deploy).toHaveBeenCalled());
    const body = vi.mocked(websiteApi.deploy).mock.calls[0]![0];
    expect(body).toMatchObject({ name: "Flipkart Stores", slug: "flipkart-stores", templateId: "ocean-breeze", theme: { id: "coral-garden" }, access: { mode: "selected", roleId: "viewer", userIds: [SK] } });
    expect(body.configuration).not.toHaveProperty("siteId");

    expect(await screen.findByText("Website created!")).toBeInTheDocument();
    expect(screen.getByTestId("website-url")).toHaveTextContent("/w/flipkart-stores");
    expect(screen.getByRole("link", { name: /Open site/ })).toHaveAttribute("href", "/w/flipkart-stores");
  });

  it("validates the name and slug before deploying", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("template-ocean-breeze"));
    await userEvent.click(within(screen.getByRole("region", { name: "Deploy website" })).getByRole("button", { name: "Deploy" }));
    expect(await screen.findByText("Enter a website name")).toBeInTheDocument();
    expect(websiteApi.deploy).not.toHaveBeenCalled();
  });
});

describe("deployed website runtime", () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/w/:slug/*" element={<WebsiteRoute />} />
        </Routes>
      </MemoryRouter>,
    );

  it("renders the site in its own theme", async () => {
    const coral = getWebsiteTheme("coral-garden")!;
    const cfg: SiteConfiguration = { ...configs.central, slug: "amazon", name: "Amazon", shell: "topbar", website: coral };
    useSession.setState({ session: session({}, [{ siteId: cfg.siteId, siteSlug: "amazon", roles: ["admin"], permissions: [] }]) });
    vi.mocked(sitesApi.config).mockResolvedValue({ version: 1, configuration: cfg });
    vi.mocked(sitesApi.access).mockResolvedValue({ id: cfg.siteId, slug: "amazon", roles: ["admin"], permissions: [...new Set(cfg.roles.flatMap((r) => r.permissions))], activeReleaseVersion: 1 });
    const { container } = renderAt("/w/amazon");
    await waitFor(() => expect(container.querySelector('[data-website="coral-garden"]')).not.toBeNull());
    const root = container.querySelector<HTMLElement>("[data-website]")!;
    expect(root.dataset.card).toBe("bordered");
    expect(root.style.getPropertyValue("--ws-primary")).toBe("#F97316");
    expect(within(root).getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("opens a deployed website in its own theme when chosen from the site switcher (/s/...)", async () => {
    const rose = getWebsiteTheme("rose-petal")!;
    const cfg: SiteConfiguration = { ...configs.central, slug: "amazon", name: "Amazon", shell: "topbar", website: rose };
    useSession.setState({ session: session({}, [{ siteId: cfg.siteId, siteSlug: "amazon", roles: ["admin"], permissions: [] }]) });
    vi.mocked(sitesApi.config).mockResolvedValue({ version: 1, configuration: cfg });
    vi.mocked(sitesApi.access).mockResolvedValue({ id: cfg.siteId, slug: "amazon", roles: ["admin"], permissions: [...new Set(cfg.roles.flatMap((r) => r.permissions))], activeReleaseVersion: 1 });
    const { container } = render(
      <MemoryRouter initialEntries={["/s/amazon"]}>
        <Routes>
          <Route path="/s/:slug/*" element={<SiteRoute />} />
          <Route path="/w/:slug/*" element={<WebsiteRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector('[data-website="rose-petal"]')).not.toBeNull());
    expect(container.querySelector("[data-shell=sidebar], [data-shell=topbar-cards]")).toBeNull();
  });

  it("keeps ordinary sites in the OpsHub shell", async () => {
    const cfg = configs.central;
    useSession.setState({ session: session({}, [{ siteId: cfg.siteId, siteSlug: cfg.slug, roles: ["admin"], permissions: [] }]) });
    vi.mocked(sitesApi.config).mockResolvedValue({ version: 1, configuration: cfg });
    vi.mocked(sitesApi.access).mockResolvedValue({ id: cfg.siteId, slug: cfg.slug, roles: ["admin"], permissions: [...new Set(cfg.roles.flatMap((r) => r.permissions))], activeReleaseVersion: 1 });
    const { container } = render(
      <MemoryRouter initialEntries={[`/s/${cfg.slug}`]}>
        <Routes>
          <Route path="/s/:slug/*" element={<SiteRoute />} />
          <Route path="/w/:slug/*" element={<WebsiteRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-shell]")).not.toBeNull());
    expect(container.querySelector("[data-website]")).toBeNull();
  });

  it("lets visitors minimize and expand a sidebar website, and remembers the choice", async () => {
    const cfg: SiteConfiguration = { ...configs.central, slug: "oceanic", name: "Oceanic", shell: "sidebar", website: ocean };
    localStorage.removeItem("opshub:website-nav-collapsed:oceanic");
    useSession.setState({ session: session({}, [{ siteId: cfg.siteId, siteSlug: "oceanic", roles: ["admin"], permissions: [] }]) });
    vi.mocked(sitesApi.config).mockResolvedValue({ version: 1, configuration: cfg });
    vi.mocked(sitesApi.access).mockResolvedValue({ id: cfg.siteId, slug: "oceanic", roles: ["admin"], permissions: [...new Set(cfg.roles.flatMap((r) => r.permissions))], activeReleaseVersion: 1 });
    const first = renderAt("/w/oceanic");
    const sidebar = await screen.findByRole("complementary", { name: "Sidebar" });
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(within(sidebar).getByRole("navigation", { name: "Main" })).toHaveTextContent("Inventory");

    await userEvent.click(screen.getByRole("button", { name: "Minimize sidebar" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(within(sidebar).getByRole("link", { name: "Inventory" })).toBeInTheDocument(); // still reachable, label is screen-reader only
    expect(localStorage.getItem("opshub:website-nav-collapsed:oceanic")).toBe("1");

    first.unmount();
    renderAt("/w/oceanic");
    expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toHaveAttribute("data-collapsed", "false");
  });

  it("shows a 403 to people without access", async () => {
    vi.mocked(sitesApi.list).mockResolvedValue([]);
    renderAt("/w/secret-site");
    expect(await screen.findByText("You don’t have access to this website")).toBeInTheDocument();
  });
});

describe("theme previews", () => {
  it("draws every built-in theme", () => {
    for (const t of WEBSITE_THEMES) {
      const { unmount } = render(<WebsitePreview theme={t} />);
      expect(screen.getByRole("img", { name: `Preview of the ${t.name} theme` })).toBeInTheDocument();
      unmount();
    }
  });
});

describe("OpsHub sidebar", () => {
  it("shows icons only when minimized, with names kept for tooltips and screen readers", async () => {
    renderInSite(<SiteShell title="Inventory"><p>content</p></SiteShell>, { config: configs.central, permissions: ["inventory:view", "dashboard:view", "config:manage"] });
    const main = screen.getByRole("navigation", { name: "Main" });
    const link = within(main).getByRole("link", { name: /Inventory/i });
    expect(link.querySelector(".sr-only")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    for (const a of within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link")) {
      const label = a.querySelector(".sr-only");
      expect(label, a.textContent ?? "").not.toBeNull();
      expect(a.textContent).toBe(label!.textContent); // no visible text beside the icon
      expect(a).toHaveAttribute("title", label!.textContent);
    }
    expect(screen.getByRole("navigation", { name: "Platform administration" })).toBeInTheDocument();
    expect(screen.queryByText("Platform Admin")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
