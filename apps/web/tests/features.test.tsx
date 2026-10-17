import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleNode, PageDefinition } from "@opshub/contracts";
import { PcbRepairModule } from "../src/features/pcb-repair/PcbRepairModule";
import { ReturnsModule } from "../src/features/returns/ReturnsModule";
import { ReportsModule } from "../src/features/reports/ReportsModule";
import { configs, renderInSite } from "./helpers";

vi.mock("../src/services", () => ({
  opsApi: {
    items: vi.fn(),
    requests: vi.fn(),
    assignments: vi.fn(),
    repairs: vi.fn(),
    createRepair: vi.fn(),
    updateRepairStatus: vi.fn(),
    returns: vi.fn(),
    createReturn: vi.fn(),
    updateReturnStatus: vi.fn(),
    stockSummary: vi.fn(),
    downloadExcel: vi.fn(),
  },
  sitesApi: { modules: vi.fn().mockResolvedValue([]) },
}));

import { opsApi } from "../src/services";

const dummyPage: PageDefinition = {
  id: "p1",
  title: "Test Page",
  path: "test",
  nodeId: "n1",
  layoutId: "data-table",
};

const dummyNode: ModuleNode = {
  id: "n1",
  moduleType: "pcb-repair",
  position: { x: 0, y: 0 },
  config: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(opsApi.items).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
  vi.mocked(opsApi.assignments).mockResolvedValue([]);
  vi.mocked(opsApi.stockSummary).mockResolvedValue({ totalItems: 0, belowReorderLevel: 0, source: "database" });
  vi.mocked(opsApi.downloadExcel).mockResolvedValue(new Blob([]));
});

describe("PcbRepairModule", () => {
  it("renders repairs list and allows status transitions", async () => {
    vi.mocked(opsApi.repairs).mockResolvedValue({
      items: [
        {
          id: "rep-1",
          siteId: configs.service.siteId,
          boardSerial: "PCB-9000-X",
          status: "received",
          technicianId: null,
          createdAt: "2026-03-01T10:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    vi.mocked(opsApi.updateRepairStatus).mockResolvedValue({
      id: "rep-1",
      siteId: configs.service.siteId,
      boardSerial: "PCB-9000-X",
      status: "diagnosing",
      technicianId: null,
      createdAt: "2026-03-01T10:00:00.000Z",
    });

    renderInSite(<PcbRepairModule node={dummyNode} page={dummyPage} layout="data-table" />, {
      config: configs.service,
      permissions: ["repair:view", "repair:update"],
    });

    expect(await screen.findByText("PCB-9000-X")).toBeInTheDocument();

    const moveBtn = screen.getByRole("button", { name: "diagnosing" });
    expect(moveBtn).toBeInTheDocument();

    fireEvent.click(moveBtn);

    await waitFor(() => {
      expect(opsApi.updateRepairStatus).toHaveBeenCalledWith(
        configs.service.siteId,
        "rep-1",
        "diagnosing",
      );
    });
  });

  it("submits a new PCB intake", async () => {
    const user = userEvent.setup();
    vi.mocked(opsApi.repairs).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
    vi.mocked(opsApi.createRepair).mockResolvedValue({
      id: "rep-new",
      siteId: configs.service.siteId,
      boardSerial: "BOARD-XYZ",
      status: "received",
      technicianId: null,
      createdAt: "2026-03-01T12:00:00.000Z",
    });

    renderInSite(<PcbRepairModule node={dummyNode} page={dummyPage} layout="data-table" />, {
      config: configs.service,
      permissions: ["repair:view", "repair:create"],
    });

    await screen.findByText("No repair jobs recorded");

    const intakeBtn = screen.getByRole("button", { name: /Log PCB for repair/i });
    await user.click(intakeBtn);

    const serialInput = screen.getByLabelText(/Board Serial Number/i);
    await user.type(serialInput, "BOARD-XYZ");

    const submitBtn = screen.getByRole("button", { name: /Submit repair/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(opsApi.createRepair).toHaveBeenCalledWith(
        configs.service.siteId,
        {
          boardSerial: "BOARD-XYZ",
        },
      );
    });
  });
});

describe("ReturnsModule", () => {
  it("renders returns and performs restock triage", async () => {
    vi.mocked(opsApi.returns).mockResolvedValue({
      items: [
        {
          id: "ret-1",
          siteId: configs.central.siteId,
          assignmentId: "00000000-0000-4000-8000-000000000001",
          quantity: 5,
          status: "inspected",
          createdAt: "2026-03-01T08:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    vi.mocked(opsApi.updateReturnStatus).mockResolvedValue({
      id: "ret-1",
      siteId: configs.central.siteId,
      assignmentId: "00000000-0000-4000-8000-000000000001",
      quantity: 5,
      status: "restocked",
      createdAt: "2026-03-01T08:00:00.000Z",
    });

    renderInSite(<ReturnsModule node={dummyNode} page={dummyPage} layout="data-table" />, {
      config: configs.central,
      permissions: ["return:view", "return:process"],
    });

    expect(await screen.findByText("5 items")).toBeInTheDocument();

    const restockBtn = screen.getByRole("button", { name: /Restock/i });
    fireEvent.click(restockBtn);

    await waitFor(() => {
      expect(opsApi.updateReturnStatus).toHaveBeenCalledWith(
        configs.central.siteId,
        "ret-1",
        "restocked",
      );
    });
  });
});

describe("ReportsModule", () => {
  it("renders stock KPI summaries and triggers report download", async () => {
    vi.mocked(opsApi.stockSummary).mockResolvedValue({
      totalItems: 42,
      belowReorderLevel: 3,
      source: "database",
    });
    vi.mocked(opsApi.items).mockResolvedValue({
      items: [
        {
          id: "it-1",
          siteId: configs.central.siteId,
          sku: "CAP-100UF",
          name: "Capacitor 100uF",
          unit: "pcs",
          onHand: 2,
          reorderLevel: 10,
          extras: {},
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    });

    renderInSite(<ReportsModule node={dummyNode} page={dummyPage} layout="dashboard" />, {
      config: configs.central,
      permissions: ["reports:view"],
    });

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("CAP-100UF")).toBeInTheDocument();

    const exportBtn = screen.getByRole("button", { name: /Export Excel/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(opsApi.downloadExcel).toHaveBeenCalledWith(configs.central.siteId);
    });
  });
});
