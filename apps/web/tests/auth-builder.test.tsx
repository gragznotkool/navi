import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleDefinition, SiteConfiguration } from "@opshub/contracts";
import { LoginPage } from "../src/features/auth/LoginPage";
import { BuilderPage } from "../src/features/builder/BuilderPage";
import { addEdge, addModule, canConnect, removeModule } from "../src/features/builder/configOps";
import { ApiRequestError } from "../src/lib/api";
import { useSession } from "../src/stores/session";
import { configs, renderInSite } from "./helpers";

vi.mock("../src/services", () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
  sitesApi: { modules: vi.fn(), dataTypes: vi.fn() },
  configApi: { validate: vi.fn(), saveDraft: vi.fn(), preview: vi.fn(), draft: vi.fn(), discardDraft: vi.fn() },
  releasesApi: { publish: vi.fn(), impact: vi.fn() },
}));
import { authApi, configApi, releasesApi, sitesApi } from "../src/services";

const def = (over: Partial<ModuleDefinition> & Pick<ModuleDefinition, "type">): ModuleDefinition => ({
  displayName: over.type, category: "core", description: "d", version: "1.0.0", ports: [], dependencies: [], configFields: [], permissions: [], defaults: {},
  platformModule: false, frontendRenderer: "r", backendService: "b", implementationStatus: "partial", ...over,
});
const registry: ModuleDefinition[] = [
  def({ type: "auth-rbac", displayName: "Authentication and RBAC", platformModule: true, ports: [{ id: "identity-out", label: "Identity", direction: "output", dataType: "identity" }] }),
  def({ type: "dashboard-shell", displayName: "Dashboard", platformModule: true, ports: [{ id: "identity-in", label: "Identity", direction: "input", dataType: "identity" }], permissions: ["dashboard:view"] }),
  def({ type: "return-management", displayName: "Return Management", permissions: ["return:view", "return:process"] }),
  def({ type: "inventory", displayName: "Inventory", permissions: ["inventory:view"], ports: [{ id: "stock-out", label: "Stock", direction: "output", dataType: "stock-item" }] }),
  def({ type: "approval", displayName: "Approval", ports: [{ id: "request-in", label: "Requests", direction: "input", dataType: "request" }] }),
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(configApi.draft).mockResolvedValue(null);
  useSession.setState({ status: "anonymous", session: null });
});

describe("login form", () => {
  const renderLogin = () => render(<MemoryRouter><LoginPage /></MemoryRouter>);

  it("validates before calling the API", async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it("shows the server's error for bad credentials", async () => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiRequestError(401, "unauthorized", "Invalid email or password"));
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(useSession.getState().status).toBe("anonymous");
  });
});

describe("configOps", () => {
  it("adds a module with page, navigation and admin permissions", () => {
    const next = addModule(configs.distribution, registry[2]!, { x: 0, y: 0 });
    expect(next.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(true);
    expect(next.pages.some((p) => p.nodeId === "return-management" && p.requiredPermission === "return:view")).toBe(true);
    expect(next.roles.find((r) => r.id === "admin")!.permissions).toContain("return:process");
    expect(configs.distribution.modules.nodes.some((n) => n.moduleType === "return-management")).toBe(false); // input untouched
  });
  it("removing a module cleans pages, nav, edges and orphaned permissions", () => {
    const withModule = addModule(configs.distribution, registry[2]!, { x: 0, y: 0 });
    const removed = removeModule(withModule, "return-management", registry);
    expect(removed.pages.some((p) => p.nodeId === "return-management")).toBe(false);
    expect(removed.roles.find((r) => r.id === "admin")!.permissions).not.toContain("return:view");
  });
  it("connects only output->input ports of compatible types", () => {
    const cfg = addModule(configs.central, registry[3]!, { x: 0, y: 0 });
    const dataTypes = [{ id: "stock-item", assignableTo: [] }, { id: "identity", assignableTo: [] }];
    const ok = { sourceNodeId: "auth-rbac", sourcePortId: "identity-out", targetNodeId: "dashboard-shell", targetPortId: "identity-in" };
    expect(canConnect(registry, dataTypes, ok, cfg)).toBe(true);
    expect(canConnect(registry, dataTypes, { ...ok, sourceNodeId: "dashboard-shell", targetNodeId: "auth-rbac" }, cfg)).toBe(false);
    expect(canConnect(registry, dataTypes, { sourceNodeId: "inventory", sourcePortId: "stock-out", targetNodeId: "dashboard-shell", targetPortId: "identity-in" }, cfg)).toBe(false);
    expect(addEdge(cfg, ok).modules.edges.filter((e) => e.id.includes("identity-out->dashboard-shell")).length).toBe(1);
  });
});

describe("BuilderPage", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor() {} });
    vi.mocked(sitesApi.modules).mockResolvedValue(registry);
    vi.mocked(sitesApi.dataTypes).mockResolvedValue([]);
  });
  const mount = (cfg: SiteConfiguration = configs.distribution) =>
    renderInSite(<BuilderPage activeVersion={1} activeConfig={cfg} />, { config: cfg, permissions: ["config:manage"] });

  const addReturns = async () => {
    await screen.findByText("Configuration builder");
    await userEvent.selectOptions(screen.getByLabelText("Add module"), "return-management");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
  };

  it("keeps Publish disabled until the server validates the draft", async () => {
    mount();
    await addReturns();
    expect(screen.getByRole("button", { name: "Review & publish" })).toBeDisabled();
    expect(screen.getByText("Unvalidated changes")).toBeInTheDocument();
  });

  it("shows server validation errors and keeps Publish disabled", async () => {
    vi.mocked(configApi.validate).mockResolvedValue({ valid: false, warnings: [], errors: [{ severity: "error", stage: "dependencies", code: "dependencies.missing", message: 'Module "approval" requires "request"' }] });
    mount();
    await addReturns();
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(await screen.findByText(/requires "request"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & publish" })).toBeDisabled();
  });

  it("publishes only after a valid server verdict and sends the base version", async () => {
    vi.mocked(configApi.validate).mockResolvedValue({ valid: true, warnings: [], errors: [] });
    vi.mocked(releasesApi.impact).mockResolvedValue({ valid: true, errors: [], sentences: ["The “Return Management” module is added."], impact: { modulesAdded: [], modulesRemoved: [], fieldsHidden: [], fieldsRemoved: [], roleChanges: [], openRequestsByVersion: [], destructive: false, destructiveReasons: [] } });
    vi.mocked(releasesApi.publish).mockResolvedValue({ id: "r", siteId: "s", version: 2, note: null, publishedBy: "u", publishedAt: "2026-01-01T00:00:00.000Z", rolledBackToVersion: null, isActive: true });
    mount();
    await addReturns();
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review & publish" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Review & publish" }));
    expect(await screen.findByText("The “Return Management” module is added.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish release" }));
    await waitFor(() => expect(releasesApi.publish).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ baseVersion: 1 })));
  });

  it("surfaces a stale-draft conflict and blocks further publishing", async () => {
    vi.mocked(configApi.validate).mockResolvedValue({ valid: true, warnings: [], errors: [] });
    vi.mocked(releasesApi.impact).mockResolvedValue({ valid: true, errors: [], sentences: ["The “Return Management” module is added."], impact: { modulesAdded: [], modulesRemoved: [], fieldsHidden: [], fieldsRemoved: [], roleChanges: [], openRequestsByVersion: [], destructive: false, destructiveReasons: [] } });
    vi.mocked(releasesApi.publish).mockRejectedValue(new ApiRequestError(409, "stale_draft", "Draft is based on version 1 but the active version is 2."));
    mount();
    await addReturns();
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review & publish" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Review & publish" }));
    expect(await screen.findByText("The “Return Management” module is added.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish release" }));
    expect(await screen.findByText(/active release changed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & publish" })).toBeDisabled();
  });
});
