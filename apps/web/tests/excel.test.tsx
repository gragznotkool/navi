import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportReport } from "@opshub/contracts";
import { ExcelPanel } from "../src/features/inventory/ExcelPanel";
import { SiteRuntimeProvider } from "../src/runtime/context";
import { configs } from "./helpers";

vi.mock("../src/services", () => ({ excelApi: { download: vi.fn(), importInventory: vi.fn() } }));
import { excelApi } from "../src/services";

const cfg = configs.central;
const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  dryRun: true,
  applied: false,
  replayed: false,
  totals: { rows: 2, create: 1, update: 1, unchanged: 0, errors: 0, stockChanges: 2 },
  fileErrors: [],
  rows: [
    { row: 2, sku: "BRG-6204", action: "update", changes: ["On hand: 120 to 130 (+10, recorded in the stock ledger)"], errors: [] },
    { row: 3, sku: "NEW-1", action: "create", changes: ["New item “Widget” with 5 each in stock."], errors: [] },
  ],
  ...over,
});
const xlsx = (name = "stock.xlsx", size = 100) => new File([new Uint8Array(size)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

const mount = (permissions: string[], onImported = vi.fn()) =>
  render(
    <MemoryRouter>
      <SiteRuntimeProvider value={{ siteId: cfg.siteId, slug: cfg.slug, version: 1, config: cfg, permissions: new Set(permissions), preview: false, basePath: `/s/${cfg.slug}`, reload: () => undefined }}>
        <ExcelPanel onImported={onImported} />
      </SiteRuntimeProvider>
    </MemoryRouter>,
  );
const choose = (f: File) => userEvent.upload(screen.getByLabelText("Import from Excel"), f);

beforeEach(() => {
  vi.resetAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

describe("Excel panel", () => {
  it("shows only what the user's permissions allow", () => {
    const { unmount } = mount(["inventory:view"]);
    expect(screen.getByRole("button", { name: /Export inventory/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Import from Excel")).not.toBeInTheDocument();
    unmount();
    const { container } = mount([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("exports through the API and saves a file named after the site", async () => {
    vi.mocked(excelApi.download).mockResolvedValue(new Blob(["x"]));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mount(["inventory:view"]);
    await userEvent.click(screen.getByRole("button", { name: /Export inventory/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(excelApi.download).toHaveBeenCalledWith(cfg.siteId, "reports/inventory");
    click.mockRestore();
  });

  it("a chosen file is checked as a dry run first, and nothing is applied until the user presses Apply", async () => {
    vi.mocked(excelApi.importInventory).mockResolvedValueOnce(report());
    mount(["inventory:view", "inventory:manage"]);
    await choose(xlsx());
    expect(await screen.findByLabelText("Import preview")).toHaveTextContent("Preview: nothing changed yet");
    expect(excelApi.importInventory).toHaveBeenCalledTimes(1);
    expect(excelApi.importInventory).toHaveBeenCalledWith(cfg.siteId, expect.any(File), { apply: false });
    expect(screen.getByRole("list", { name: "What would change" })).toHaveTextContent("On hand: 120 to 130");
    expect(screen.getByRole("button", { name: /Apply import/ })).toBeEnabled();
  });

  it("applies with one idempotency key per chosen file, then reports success and refreshes the list", async () => {
    const onImported = vi.fn();
    vi.mocked(excelApi.importInventory).mockResolvedValueOnce(report()).mockResolvedValueOnce(report({ dryRun: false, applied: true }));
    mount(["inventory:manage"], onImported);
    await choose(xlsx());
    await userEvent.click(await screen.findByRole("button", { name: /Apply import/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    const call = vi.mocked(excelApi.importInventory).mock.calls[1]!;
    expect(call[2]).toMatchObject({ apply: true, key: expect.stringMatching(/^import-/) });
    expect(await screen.findByLabelText("Import preview")).toHaveTextContent("Imported");
  });

  it("a file with problems cannot be applied, and every problem is shown", async () => {
    vi.mocked(excelApi.importInventory).mockResolvedValueOnce(
      report({
        totals: { rows: 2, create: 0, update: 0, unchanged: 0, errors: 1, stockChanges: 0 },
        fileErrors: ["Column “Password” is not recognised."],
        rows: [{ row: 4, sku: "BAD", action: "error", changes: [], errors: ["On hand cannot be negative"] }],
      }),
    );
    mount(["inventory:manage"]);
    await choose(xlsx());
    expect(await screen.findByRole("alert", { name: "Problems with the file" })).toHaveTextContent("not recognised");
    expect(screen.getByRole("list", { name: "Rows with problems" })).toHaveTextContent("Row 4 (BAD): On hand cannot be negative");
    expect(screen.getByRole("button", { name: /Apply import/ })).toBeDisabled();
    expect(screen.getByText("Cannot import")).toBeInTheDocument();
  });

  it("does not offer Apply when the file would change nothing", async () => {
    vi.mocked(excelApi.importInventory).mockResolvedValueOnce(report({ totals: { rows: 1, create: 0, update: 0, unchanged: 1, errors: 0, stockChanges: 0 }, rows: [{ row: 2, sku: "A", action: "unchanged", changes: [], errors: [] }] }));
    mount(["inventory:manage"]);
    await choose(xlsx());
    expect(await screen.findByText(/Nothing in this file would change anything/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply import/ })).toBeDisabled();
  });

  it("rejects the wrong file type and oversized files before uploading anything", async () => {
    mount(["inventory:manage"]);
    await userEvent.upload(screen.getByLabelText("Import from Excel"), new File(["a,b"], "stock.csv", { type: "text/csv" }), { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("ending in .xlsx");
    await choose(xlsx("big.xlsx", 1_000_001));
    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 1 MB");
    expect(excelApi.importInventory).not.toHaveBeenCalled();
  });

  it("shows a server rejection plainly, and a failed apply leaves nothing applied", async () => {
    const { ApiRequestError } = await import("../src/lib/api");
    vi.mocked(excelApi.importInventory).mockRejectedValueOnce(new ApiRequestError(422, "invalid_spreadsheet", "This is not an Excel (.xlsx) file."));
    mount(["inventory:manage"]);
    await choose(xlsx());
    expect(await screen.findByRole("alert")).toHaveTextContent("not an Excel (.xlsx) file");
    expect(screen.queryByRole("button", { name: /Apply import/ })).not.toBeInTheDocument();
  });

  it("when apply is refused because of row problems it says nothing was imported", async () => {
    vi.mocked(excelApi.importInventory).mockResolvedValueOnce(report()).mockResolvedValueOnce(report({ dryRun: false, applied: false, totals: { rows: 2, create: 0, update: 0, unchanged: 0, errors: 1, stockChanges: 0 }, rows: [{ row: 2, sku: "X", action: "error", changes: [], errors: ["changed meanwhile"] }] }));
    const onImported = vi.fn();
    mount(["inventory:manage"], onImported);
    await choose(xlsx());
    await userEvent.click(await screen.findByRole("button", { name: /Apply import/ }));
    expect(await screen.findByText(/Nothing was imported/)).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });
});
