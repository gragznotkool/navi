import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession, ProvisioningSnapshot } from "@opshub/contracts";
import { NewSitePage } from "../src/features/provisioning/NewSitePage";
import { ApiRequestError } from "../src/lib/api";
import { useSession } from "../src/stores/session";

vi.mock("../src/services", () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
  provisioningApi: { presets: vi.fn(), start: vi.fn(), snapshot: vi.fn() },
}));
import { authApi, provisioningApi } from "../src/services";

const admin: AuthSession = { user: { id: "10000000-0000-4000-8000-000000000001", email: "admin@opshub.local", displayName: "Admin", isPlatformAdmin: true }, memberships: [], expiresAt: "2030-01-01T00:00:00.000Z" };
const presets = [
  { id: "stores", label: "Stores and inventory", description: "Central stores.", modules: ["Inventory", "Request"], shell: "sidebar" },
  { id: "distribution", label: "Distribution", description: "Lean distribution.", modules: ["Inventory"], shell: "topbar" },
];
const job = (status: "running" | "succeeded" | "failed", error: string | null = null) => ({ id: "00000000-0000-4000-8000-0000000000aa", slug: "riverside", name: "Riverside Depot", preset: "stores", status, error, createdAt: "2026-01-01T00:00:00.000Z" });
const ev = (seq: number, level: "info" | "success" | "error", message: string) => ({ seq, level, message, at: "2026-01-01T00:00:00.000Z" });

const open = () =>
  render(
    <MemoryRouter initialEntries={["/sites/new"]}>
      <Routes>
        <Route path="/sites/new" element={<NewSitePage />} />
        <Route path="/" element={<div>HUB</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  useSession.setState({ status: "authenticated", session: admin });
  vi.mocked(provisioningApi.presets).mockResolvedValue(presets);
  vi.mocked(authApi.me).mockResolvedValue(admin);
});

describe("NewSitePage", () => {
  it("is for platform administrators only", () => {
    useSession.setState({ status: "authenticated", session: { ...admin, user: { ...admin.user, isPlatformAdmin: false } } });
    open();
    expect(screen.getByText("Platform administrators only")).toBeInTheDocument();
    expect(provisioningApi.presets).not.toHaveBeenCalled();
  });

  it("derives the address from the name until it is edited, and validates with the shared schema", async () => {
    open();
    await screen.findByText("Stores and inventory");
    await userEvent.type(screen.getByLabelText("Site name"), "Riverside Depot");
    expect(screen.getByLabelText("Address (slug)")).toHaveValue("riverside-depot");
    await userEvent.clear(screen.getByLabelText("Address (slug)"));
    await userEvent.type(screen.getByLabelText("Address (slug)"), "Bad Slug!");
    await userEvent.click(screen.getByRole("button", { name: "Create site" }));
    expect(await screen.findByText(/Use 3–40 lowercase letters/)).toBeInTheDocument();
    expect(provisioningApi.start).not.toHaveBeenCalled();
  });

  it("rejects a reserved address and a malformed administrator email before calling the server", async () => {
    open();
    await screen.findByText("Stores and inventory");
    await userEvent.type(screen.getByLabelText("Site name"), "Trust Lab");
    await userEvent.type(screen.getByLabelText("Additional administrator (optional)"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Create site" }));
    expect(await screen.findByText("This name is reserved")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(provisioningApi.start).not.toHaveBeenCalled();
  });

  it("submits the form, follows the log, and offers to open the new site when it succeeds", async () => {
    vi.mocked(provisioningApi.start).mockResolvedValue(job("running"));
    const done: ProvisioningSnapshot = {
      job: job("succeeded"),
      events: [ev(1, "info", "Starting: “Riverside Depot”"), ev(2, "success", "Site record created."), ev(3, "success", "Committed. The site is live and appears in the hub.")],
    };
    vi.mocked(provisioningApi.snapshot).mockResolvedValue(done);
    open();
    await screen.findByText("Stores and inventory");
    await userEvent.type(screen.getByLabelText("Site name"), "Riverside Depot");
    await userEvent.click(screen.getByLabelText(/Add demo stock/));
    await userEvent.click(screen.getByRole("button", { name: "Create site" }));

    expect(provisioningApi.start).toHaveBeenCalledWith(expect.objectContaining({ slug: "riverside-depot", name: "Riverside Depot", preset: "stores", demoStock: true }));
    const log = await screen.findByRole("list", { name: "Provisioning log" });
    await within(log).findByText("Committed. The site is live and appears in the hub.");
    expect(within(log).getAllByRole("listitem")).toHaveLength(3);
    expect(await screen.findByRole("link", { name: "Open site" })).toHaveAttribute("href", "/s/riverside-depot");
    await waitFor(() => expect(authApi.me).toHaveBeenCalled()); // session refreshed so the new site is a membership
  });

  it("shows a server rejection (e.g. address taken) on the form without starting a log", async () => {
    vi.mocked(provisioningApi.start).mockRejectedValue(new ApiRequestError(409, "slug_taken", "The address “riverside-depot” is already used by another site."));
    open();
    await screen.findByText("Stores and inventory");
    await userEvent.type(screen.getByLabelText("Site name"), "Riverside Depot");
    await userEvent.click(screen.getByRole("button", { name: "Create site" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already used by another site");
    expect(provisioningApi.snapshot).not.toHaveBeenCalled();
  });

  it("on failure shows why and that nothing was kept, and Try again follows the same job", async () => {
    vi.mocked(provisioningApi.start).mockResolvedValue(job("running"));
    vi.mocked(provisioningApi.snapshot).mockResolvedValue({
      job: job("failed", "The preset uses roles that are not defined on this platform: approver."),
      events: [ev(1, "info", "Starting"), ev(2, "error", "Failed: The preset uses roles that are not defined on this platform: approver."), ev(3, "error", "Everything was rolled back. No site was created.")],
    });
    open();
    await screen.findByText("Stores and inventory");
    await userEvent.type(screen.getByLabelText("Site name"), "Riverside Depot");
    await userEvent.click(screen.getByRole("button", { name: "Create site" }));
    expect(await screen.findByText("Everything was rolled back. No site was created.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("roles that are not defined");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(provisioningApi.start).toHaveBeenCalledTimes(2));
    expect(provisioningApi.start).toHaveBeenLastCalledWith(expect.objectContaining({ slug: "riverside-depot" }));
  });
});
