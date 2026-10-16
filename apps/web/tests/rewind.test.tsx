import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseSummary } from "@opshub/contracts";
import { RewindPage } from "../src/features/releases/RewindPage";
import { usePreviewStore } from "../src/features/builder/previewStore";
import { configs, renderInSite } from "./helpers";

vi.mock("../src/services", () => ({
  releasesApi: { list: vi.fn(), summary: vi.fn(), impact: vi.fn(), get: vi.fn(), rollback: vi.fn() },
}));
import { releasesApi } from "../src/services";

const rel = (version: number, over: Partial<ReleaseSummary> = {}): ReleaseSummary => ({
  id: `00000000-0000-4000-8000-00000000000${version}`,
  siteId: "s",
  version,
  note: null,
  publishedBy: "u",
  publishedByName: "Platform Admin",
  publishedAt: `2026-01-0${version}T10:00:00.000Z`,
  rolledBackToVersion: null,
  isActive: false,
  ...over,
});
// Newest first, as the API returns it; v3 is active.
const history = [rel(3, { isActive: true, note: "SLA 10s" }), rel(2), rel(1)];
const safeImpact = { modulesAdded: [], modulesRemoved: [], fieldsHidden: [], fieldsRemoved: [], roleChanges: [], openRequestsByVersion: [], destructive: false, destructiveReasons: [] };

const summaries: Record<number, string[]> = {
  1: ["This is the first release for “Distribution”."],
  2: ["A new text field “Shelf” is added to inventory items."],
  3: ["Pending approval requests now turn overdue after 10 seconds."],
};

const mount = () =>
  renderInSite(
    <Routes>
      <Route path="/" element={<RewindPage />} />
      <Route path="/preview/:slug" element={<div>PREVIEW PAGE</div>} />
    </Routes>,
    { config: configs.distribution, permissions: ["config:manage"] },
  );

beforeEach(() => {
  vi.resetAllMocks();
  usePreviewStore.setState({ drafts: {} });
  vi.mocked(releasesApi.list).mockResolvedValue(history);
  vi.mocked(releasesApi.summary).mockImplementation(async (_s, id) => {
    const v = history.find((r) => r.id === id)!.version;
    return { version: v, sentences: summaries[v]! };
  });
  vi.mocked(releasesApi.impact).mockResolvedValue({ valid: true, errors: [], sentences: ["Pending approval requests no longer have a deadline."], impact: safeImpact });
});

const slider = () => screen.getByRole("slider", { name: "Release version" });
const confirmButton = () => screen.getAllByRole("button", { name: "Roll back" }).at(-1)!;

describe("Rewind", () => {
  it("starts on the active release, explains it, and offers no rollback to itself", async () => {
    mount();
    expect(await screen.findByText("Pending approval requests now turn overdue after 10 seconds.")).toBeInTheDocument();
    expect(screen.getByText("Active now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll back to v3" })).toBeDisabled();
    expect(screen.queryByText(/If you go back to version/)).not.toBeInTheDocument();
    expect(slider()).toHaveAttribute("aria-valuetext", expect.stringMatching(/Version 3 \(active\), published .* by Platform Admin/));
  });

  it("orders the timeline oldest to newest and shows each stop in plain English as you drag", async () => {
    mount();
    await screen.findByText(/overdue after 10 seconds/);
    expect(slider()).toHaveAttribute("max", "2");
    fireEvent.change(slider(), { target: { value: "0" } });
    expect(await screen.findByText("This is the first release for “Distribution”.")).toBeInTheDocument();
    expect(screen.getByText("What version 1 changed")).toBeInTheDocument();
    expect(await screen.findByText(/If you go back to version 1/)).toBeInTheDocument();
    expect(await screen.findByText(/no longer have a deadline/)).toBeInTheDocument();
    expect(releasesApi.impact).toHaveBeenCalledWith(expect.any(String), { baseVersion: 3, targetVersion: 1 });
    expect(screen.getByRole("button", { name: "Roll back to v1" })).toBeEnabled();
    fireEvent.change(slider(), { target: { value: "1" } });
    expect(await screen.findByText("A new text field “Shelf” is added to inventory items.")).toBeInTheDocument();
  });

  it("rolls back only after the impact dialog is confirmed, sending the base version", async () => {
    vi.mocked(releasesApi.rollback).mockResolvedValue(rel(4, { isActive: true, rolledBackToVersion: 1 }));
    mount();
    await screen.findByText(/overdue after 10 seconds/);
    fireEvent.change(slider(), { target: { value: "0" } });
    await userEvent.click(await screen.findByRole("button", { name: "Roll back to v1" }));
    await screen.findByRole("dialog");
    expect(releasesApi.rollback).not.toHaveBeenCalled();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await userEvent.click(confirmButton());
    await waitFor(() => expect(releasesApi.rollback).toHaveBeenCalledWith(expect.any(String), { targetVersion: 1, baseVersion: 3 }));
  });

  it("a destructive rewind needs the acknowledgement and then sends confirmDestructive", async () => {
    vi.mocked(releasesApi.impact).mockResolvedValue({
      valid: true,
      errors: [],
      sentences: ["The “Returns” module is removed."],
      impact: { ...safeImpact, destructive: true, destructiveReasons: ["Removes a module: Return Management."] },
    });
    vi.mocked(releasesApi.rollback).mockResolvedValue(rel(4, { isActive: true }));
    mount();
    await screen.findByText(/overdue after 10 seconds/);
    fireEvent.change(slider(), { target: { value: "0" } });
    await userEvent.click(await screen.findByRole("button", { name: "Roll back to v1" }));
    await screen.findByText("Removes a module: Return Management.");
    expect(confirmButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(releasesApi.rollback).toHaveBeenCalledWith(expect.any(String), { targetVersion: 1, baseVersion: 3, confirmDestructive: true }));
  });

  it("previews a historical version read-only without changing anything", async () => {
    vi.mocked(releasesApi.get).mockResolvedValue({ release: history[2]!, configuration: configs.distribution });
    mount();
    await screen.findByText(/overdue after 10 seconds/);
    fireEvent.change(slider(), { target: { value: "0" } });
    await userEvent.click(await screen.findByRole("button", { name: "Preview version 1" }));
    expect(await screen.findByText("PREVIEW PAGE")).toBeInTheDocument();
    expect(usePreviewStore.getState().drafts[configs.distribution.slug]).toBeDefined();
    expect(releasesApi.rollback).not.toHaveBeenCalled();
  });
});
