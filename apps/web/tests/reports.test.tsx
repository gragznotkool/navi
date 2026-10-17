import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportAccess } from "@opshub/contracts";
import { ApiRequestError } from "../src/lib/api";
import { ImportDialog } from "../src/features/reports/ReportActions";

vi.mock("../src/services", () => ({ reportsApi: { import: vi.fn(), list: vi.fn(), export: vi.fn() } }));
import { reportsApi } from "../src/services";

const report: ReportAccess = {
  key: "inventory",
  title: "Inventory report",
  canExport: true,
  canImport: true,
  columns: [
    { key: "sku", header: "SKU", required: true, masked: false, importable: true },
    { key: "unitCost", header: "Unit Cost ($)", required: false, masked: true, importable: true },
  ],
};
const file = () => new File(["x"], "stock.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

beforeEach(() => vi.resetAllMocks());

describe("ImportDialog", () => {
  it("shows format hints, including columns locked for the role", () => {
    render(<ImportDialog siteId="s" report={report} onClose={() => undefined} />);
    expect(screen.getByText(/SKU \*/)).toBeInTheDocument();
    expect(screen.getByText(/Unit Cost.*locked for your role/)).toBeInTheDocument();
  });

  it("shows the exact row and cell failures when the server rejects the file", async () => {
    vi.mocked(reportsApi.import).mockRejectedValue(
      new ApiRequestError(422, "import_rejected", "Row 14: Quantity must be greater than or equal to 0. 0 rows written to database.", [
        { path: "row 14.Quantity", message: "Quantity must be greater than or equal to 0", row: 14, column: "Quantity" },
      ]),
    );
    render(<ImportDialog siteId="s" report={report} onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file()] } });
    expect(await screen.findByText(/0 rows written to database/)).toBeInTheDocument();
    const row = screen.getByRole("cell", { name: "14" }).closest("tr")!;
    expect(row).toHaveTextContent("Quantity");
    expect(row).toHaveTextContent("greater than or equal to 0");
    expect(reportsApi.import).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportsApi.import).mock.calls[0]![3]).toBe(true); // validated as a dry run, nothing written
  });

  it("previews a valid file, then imports only after confirmation", async () => {
    vi.mocked(reportsApi.import)
      .mockResolvedValueOnce({ fileName: "stock.xlsx", rowCount: 3, dryRun: true, written: 0 })
      .mockResolvedValueOnce({ fileName: "stock.xlsx", rowCount: 3, dryRun: false, written: 3 });
    render(<ImportDialog siteId="s" report={report} onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file()] } });
    fireEvent.click(await screen.findByRole("button", { name: "Import 3 rows" }));
    await waitFor(() => expect(screen.getByText(/Imported 3 rows from stock.xlsx/)).toBeInTheDocument());
    expect(vi.mocked(reportsApi.import).mock.calls.map((c) => c[3])).toEqual([true, false]);
  });
});
