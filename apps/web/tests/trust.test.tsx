import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofList, ProofResult } from "@opshub/contracts";
import { TrustConsolePage } from "../src/features/security-console/TrustConsolePage";

vi.mock("../src/services", () => ({
  trustApi: { proofs: vi.fn(), runProof: vi.fn(), checks: vi.fn() },
}));
import { trustApi } from "../src/services";

const notRun = (proofId: string): ProofResult => ({ proofId, status: "not-run", ranAt: null, durationMs: null, cells: [], evidence: {}, error: null });
const list: ProofList = {
  environment: { nodeEnv: "development", database: "localhost:5432/opshub", databaseRole: "opshub_app", labSite: "trust-lab (reserved system site)", note: "Proofs run live in THIS API's environment." },
  proofs: [
    { definition: { id: "no-context-zero-rows", title: "No tenant context → no rows", description: "d", writesToLab: false }, last: notRun("no-context-zero-rows") },
    { definition: { id: "concurrent-allocation", title: "50 simultaneous allocations against 10 units", description: "d", writesToLab: true }, last: notRun("concurrent-allocation") },
  ],
};
const ran = (proofId: string, cells: { label: string; ok: boolean }[], evidence = {}): ProofResult => ({
  proofId,
  status: cells.every((c) => c.ok) ? "pass" : "fail",
  ranAt: "2026-01-01T00:00:00.000Z",
  durationMs: 12,
  cells: cells.map((c) => ({ ...c, detail: c.ok ? "fine" : "LEAK" })),
  evidence,
  error: null,
});

const open = () => render(<MemoryRouter><TrustConsolePage /></MemoryRouter>);

describe("TrustConsolePage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(trustApi.proofs).mockResolvedValue(list);
    vi.mocked(trustApi.checks).mockResolvedValue({ generatedAt: null, checks: [] });
  });

  it("shows every proof as Not run until it is executed, and says where the proofs run", async () => {
    open();
    expect(await screen.findByText("No tenant context → no rows")).toBeInTheDocument();
    expect(screen.getAllByText("Not run")).toHaveLength(2);
    expect(screen.getByText(/Proofs run live in THIS API/)).toBeInTheDocument();
    expect(screen.getByText("opshub_app")).toBeInTheDocument();
    expect(trustApi.runProof).not.toHaveBeenCalled();
  });

  it("runs a proof and shows one dot per check with its evidence", async () => {
    vi.mocked(trustApi.runProof).mockResolvedValue(ran("concurrent-allocation", [{ label: "exactly 10 allocations succeed", ok: true }], { succeeded: 10, attempts: 50 }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Run proof: 50 simultaneous/ }));
    const dots = await screen.findByLabelText("50 simultaneous allocations against 10 units results");
    expect(within(dots).getByRole("img", { name: "exactly 10 allocations succeed: passed" })).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 checks passing", { exact: false })).toBeInTheDocument();
  });

  it("marks a failing check as failed in text and glyph, not just colour", async () => {
    vi.mocked(trustApi.runProof).mockResolvedValue(ran("no-context-zero-rows", [{ label: "inventory_items", ok: false }, { label: "requests", ok: true }]));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Run proof: No tenant context/ }));
    expect(await screen.findByRole("img", { name: "inventory_items: failed" })).toHaveTextContent("✗");
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("LEAK")).toBeInTheDocument();
  });

  it("'Run all proofs' runs each proof in turn", async () => {
    vi.mocked(trustApi.runProof).mockImplementation(async (id) => ran(id, [{ label: "x", ok: true }]));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Run all proofs" }));
    await screen.findAllByText("Passed");
    expect(vi.mocked(trustApi.runProof).mock.calls.map((c) => c[0])).toEqual(["no-context-zero-rows", "concurrent-allocation"]);
  });
});
