import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary, Assignment, RepairRecord, ReturnRecord, SiteMember } from "@opshub/contracts";
import { AnalyticsModule } from "../src/features/analytics/AnalyticsModule";
import { AdjustStock } from "../src/features/inventory/AdjustStock";
import { RepairsModule } from "../src/features/repairs/RepairsModule";
import { ReturnsModule } from "../src/features/returns/ReturnsModule";
import { UsersModule } from "../src/features/users/UsersModule";
import { ApiRequestError } from "../src/lib/api";
import { SiteRuntimeProvider } from "../src/runtime/context";
import { useSession } from "../src/stores/session";
import { configs } from "./helpers";

vi.mock("../src/services", () => ({
  returnsApi: { list: vi.fn(), create: vi.fn(), transition: vi.fn() },
  repairsApi: { list: vi.fn(), create: vi.fn(), transition: vi.fn() },
  membersApi: { list: vi.fn(), add: vi.fn(), setRoles: vi.fn(), remove: vi.fn() },
  analyticsApi: { summary: vi.fn() },
  stockApi: { adjust: vi.fn() },
  opsApi: { assignments: vi.fn() },
}));
import { analyticsApi, membersApi, opsApi, repairsApi, returnsApi, stockApi } from "../src/services";

const cfg = configs.service;
const page = { id: "p", title: "Page title", path: "p", nodeId: "n", layoutId: "l" };
const node = { id: "n", moduleType: "pcb-repair", position: { x: 0, y: 0 }, config: {} } as never;
const T = "2026-01-01T10:00:00.000Z";
const mount = (ui: React.ReactElement, permissions: string[]) =>
  render(
    <MemoryRouter>
      <SiteRuntimeProvider value={{ siteId: cfg.siteId, slug: cfg.slug, version: 1, config: cfg, permissions: new Set(permissions), preview: false, basePath: `/s/${cfg.slug}`, reload: () => undefined }}>{ui}</SiteRuntimeProvider>
    </MemoryRouter>,
  );
const props = { page, node, layout: undefined as never };

beforeEach(() => {
  vi.resetAllMocks();
  useSession.setState({ status: "authenticated", session: { user: { id: "me-id", email: "me@x.y", displayName: "Me", isPlatformAdmin: false }, memberships: [], expiresAt: "2030-01-01T00:00:00.000Z" } });
});

describe("Returns screen", () => {
  const assignment: Assignment = { id: "aaaaaaaa-0000-4000-8000-000000000001", siteId: cfg.siteId, requestId: "r", quantity: 5, configVersion: 1, lines: [], assignedBy: "u", createdAt: T };
  const ret = (status: ReturnRecord["status"]): ReturnRecord => ({ id: "bbbbbbbb-0000-4000-8000-000000000001", siteId: cfg.siteId, assignmentId: assignment.id, quantity: 2, status, createdAt: T });

  it("starts a return from an assignment", async () => {
    vi.mocked(returnsApi.list).mockResolvedValue([]);
    vi.mocked(opsApi.assignments).mockResolvedValue([assignment]);
    vi.mocked(returnsApi.create).mockResolvedValue(ret("initiated"));
    mount(<ReturnsModule {...props} />, ["return:view", "return:process"]);
    await userEvent.selectOptions(await screen.findByLabelText("Assignment"), assignment.id);
    await userEvent.clear(screen.getByLabelText("Quantity"));
    await userEvent.type(screen.getByLabelText("Quantity"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Start return" }));
    await waitFor(() => expect(returnsApi.create).toHaveBeenCalledWith(cfg.siteId, { assignmentId: assignment.id, quantity: 2 }));
  });

  it("offers only the legal next steps, and restocking carries one idempotency key that is reused on retry", async () => {
    vi.mocked(returnsApi.list).mockResolvedValue([ret("inspected")]);
    vi.mocked(opsApi.assignments).mockResolvedValue([]);
    vi.mocked(returnsApi.transition).mockRejectedValueOnce(new ApiRequestError(0, "network", "offline")).mockResolvedValueOnce(ret("restocked"));
    mount(<ReturnsModule {...props} />, ["return:view", "return:process"]);
    expect(await screen.findByRole("button", { name: /Restock return/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject return/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark inspected/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Restock return/ }));
    await waitFor(() => expect(returnsApi.transition).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("button", { name: /Restock return/ }));
    await waitFor(() => expect(returnsApi.transition).toHaveBeenCalledTimes(2));
    const k1 = vi.mocked(returnsApi.transition).mock.calls[0]![3];
    const k2 = vi.mocked(returnsApi.transition).mock.calls[1]![3];
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1); // the retry after a network failure reuses the key
  });

  it("is read-only for someone who can only view returns, and finished returns have no actions", async () => {
    vi.mocked(returnsApi.list).mockResolvedValue([ret("initiated"), { ...ret("restocked"), id: "cccccccc-0000-4000-8000-000000000001" }]);
    mount(<ReturnsModule {...props} />, ["return:view"]);
    expect(await screen.findByText("Read-only for your role")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.queryByText("Start a return")).not.toBeInTheDocument();
    expect(opsApi.assignments).not.toHaveBeenCalled();
  });
});

describe("Repairs screen", () => {
  const repair = (status: RepairRecord["status"]): RepairRecord => ({ id: "dddddddd-0000-4000-8000-000000000001", siteId: cfg.siteId, boardSerial: "PCB-1", status, technicianId: null, createdAt: T });

  it("validates the serial in the browser, then receives the board", async () => {
    vi.mocked(repairsApi.list).mockResolvedValue([]);
    vi.mocked(repairsApi.create).mockResolvedValue(repair("received"));
    mount(<RepairsModule {...props} />, ["repair:view", "repair:update"]);
    await userEvent.click(await screen.findByRole("button", { name: "Receive board" }));
    expect(await screen.findByText("Enter the board serial")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Board serial"), "bad serial!");
    await userEvent.click(screen.getByRole("button", { name: "Receive board" }));
    expect(await screen.findByText(/Serials use letters/)).toBeInTheDocument();
    expect(repairsApi.create).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Board serial"));
    await userEvent.type(screen.getByLabelText("Board serial"), "PCB-1");
    await userEvent.click(screen.getByRole("button", { name: "Receive board" }));
    await waitFor(() => expect(repairsApi.create).toHaveBeenCalledWith(cfg.siteId, { boardSerial: "PCB-1" }));
  });

  it("shows the workflow's next steps for each status and sends the chosen one", async () => {
    vi.mocked(repairsApi.list).mockResolvedValue([repair("testing")]);
    vi.mocked(repairsApi.transition).mockResolvedValue(repair("completed"));
    mount(<RepairsModule {...props} />, ["repair:view", "repair:update"]);
    expect(await screen.findByRole("button", { name: "Back to repair: PCB-1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Complete: PCB-1" }));
    await waitFor(() => expect(repairsApi.transition).toHaveBeenCalledWith(cfg.siteId, repair("testing").id, "completed"));
  });

  it("shows a duplicate-serial refusal from the server on the form", async () => {
    vi.mocked(repairsApi.list).mockResolvedValue([]);
    vi.mocked(repairsApi.create).mockRejectedValue(new ApiRequestError(409, "duplicate_serial", "A repair for board “PCB-1” already exists."));
    mount(<RepairsModule {...props} />, ["repair:update"]);
    await userEvent.type(await screen.findByLabelText("Board serial"), "PCB-1");
    await userEvent.click(screen.getByRole("button", { name: "Receive board" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });
});

describe("Users screen", () => {
  const members: SiteMember[] = [
    { userId: "me-id", email: "me@x.y", displayName: "Me", roles: ["admin"] },
    { userId: "other-id", email: "tech@x.y", displayName: "Tara", roles: ["technician"] },
  ];

  it("lets a manager change roles and remove a person, but never edit their own", async () => {
    vi.mocked(membersApi.list).mockResolvedValue(members);
    vi.mocked(membersApi.setRoles).mockResolvedValue(members[1]!);
    vi.mocked(membersApi.remove).mockResolvedValue(undefined);
    mount(<UsersModule {...props} />, ["users:view", "users:manage"]);
    const own = await screen.findByLabelText("Administrator for me@x.y");
    expect(own).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Approver for tech@x.y"));
    await waitFor(() => expect(membersApi.setRoles).toHaveBeenCalledWith(cfg.siteId, "other-id", ["technician", "approver"]));
    await userEvent.click(screen.getByLabelText("Technician for tech@x.y"));
    await waitFor(() => expect(membersApi.remove).toHaveBeenCalledWith(cfg.siteId, "other-id")); // removing the last role removes the person
  });

  it("adds a person by email and shows server refusals", async () => {
    vi.mocked(membersApi.list).mockResolvedValue(members);
    vi.mocked(membersApi.add).mockRejectedValueOnce(new ApiRequestError(404, "user_not_found", "No account with that email exists.")).mockResolvedValueOnce(members[1]!);
    mount(<UsersModule {...props} />, ["users:view", "users:manage"]);
    await userEvent.type(await screen.findByLabelText("Email of an existing account"), "new@x.y");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(membersApi.add).toHaveBeenCalledWith(cfg.siteId, { email: "new@x.y", role: cfg.roles[0]!.id }));
    expect(screen.getByLabelText("Email of an existing account")).toHaveValue("new@x.y"); // kept for correction after a failure
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByLabelText("Email of an existing account")).toHaveValue(""));
  });

  it("is read-only without users:manage", async () => {
    vi.mocked(membersApi.list).mockResolvedValue(members);
    mount(<UsersModule {...props} />, ["users:view"]);
    expect(await screen.findByLabelText("Technician for tech@x.y")).toBeDisabled();
    expect(screen.queryByText("Add a person")).not.toBeInTheDocument();
  });
});

describe("Analytics screen", () => {
  const base: AnalyticsSummary = { stock: null, requests: null, movements: null, returns: null, repairs: null, source: "database" };

  it("shows only the blocks the server returned", async () => {
    vi.mocked(analyticsApi.summary).mockResolvedValue({ ...base, stock: { totalItems: 4, totalOnHand: 90, belowReorderLevel: 1, outOfStock: 0 }, requests: { byStatus: { submitted: 2 }, overdue: 1 } });
    mount(<AnalyticsModule {...props} />, ["analytics:view"]);
    expect(await screen.findByText("Inventory items")).toBeInTheDocument();
    expect(screen.getByText("90 units on hand")).toBeInTheDocument();
    expect(screen.getByText("Overdue approvals")).toBeInTheDocument();
    expect(screen.getByText("Requests by status")).toBeInTheDocument();
    expect(screen.queryByText("Returns by status")).not.toBeInTheDocument();
  });

  it("explains an empty result and a failure honestly", async () => {
    vi.mocked(analyticsApi.summary).mockResolvedValueOnce(base);
    const { unmount } = mount(<AnalyticsModule {...props} />, ["analytics:view"]);
    expect(await screen.findByText("No analytics sources available")).toBeInTheDocument();
    unmount();
    vi.mocked(analyticsApi.summary).mockRejectedValueOnce(new ApiRequestError(500, "internal_error", "An unexpected error occurred"));
    mount(<AnalyticsModule {...props} />, ["analytics:view"]);
    expect(await screen.findByText("An unexpected error occurred")).toBeInTheDocument();
  });
});

describe("Adjust stock", () => {
  const item = "eeeeeeee-0000-4000-8000-000000000001";
  it("needs a number and a reason, then sends one change with an idempotency key", async () => {
    vi.mocked(stockApi.adjust).mockResolvedValue({ onHand: 12 });
    const done = vi.fn();
    render(<AdjustStock siteId={cfg.siteId} itemId={item} onDone={done} />);
    const apply = screen.getByRole("button", { name: "Apply adjustment" });
    expect(apply).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Change/), "-3");
    await userEvent.type(screen.getByLabelText("Reason"), "Damaged in handling");
    await userEvent.click(apply);
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(stockApi.adjust).toHaveBeenCalledWith(cfg.siteId, item, { delta: -3, reason: "Damaged in handling" }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it("rejects zero and fractions in the browser, shows server refusals, and reuses the key after a network failure", async () => {
    render(<AdjustStock siteId={cfg.siteId} itemId={item} onDone={() => undefined} />);
    await userEvent.type(screen.getByLabelText(/Change/), "0");
    await userEvent.type(screen.getByLabelText("Reason"), "just testing");
    await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be zero");
    await userEvent.clear(screen.getByLabelText(/Change/));
    await userEvent.type(screen.getByLabelText(/Change/), "2");
    vi.mocked(stockApi.adjust).mockRejectedValueOnce(new ApiRequestError(0, "network", "offline")).mockRejectedValueOnce(new ApiRequestError(409, "insufficient_stock", "Insufficient stock: 1 available, 5 requested"));
    await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));
    await waitFor(() => expect(stockApi.adjust).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));
    await waitFor(() => expect(stockApi.adjust).toHaveBeenCalledTimes(2));
    expect(vi.mocked(stockApi.adjust).mock.calls[1]![3]).toBe(vi.mocked(stockApi.adjust).mock.calls[0]![3]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient stock");
  });
});
