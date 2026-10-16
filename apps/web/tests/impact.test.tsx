import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImpactReport } from "@opshub/contracts";
import { ImpactDialog } from "../src/features/releases/ImpactDialog";
import { addField, removeField, updateField } from "../src/features/builder/configOps";
import { configs } from "./helpers";

vi.mock("../src/services", () => ({
  releasesApi: { impact: vi.fn() },
}));
import { releasesApi } from "../src/services";

const emptyImpact = { modulesAdded: [], modulesRemoved: [], fieldsHidden: [], fieldsRemoved: [], roleChanges: [], openRequestsByVersion: [], destructive: false, destructiveReasons: [] };
const safe: ImpactReport = { valid: true, errors: [], sentences: ["A new text field “Shelf” is added to inventory items."], impact: emptyImpact };
const risky: ImpactReport = {
  valid: true,
  errors: [],
  sentences: ["The “Unit price” field is hidden on inventory items. 3 rows keep the saved value, and it comes back if the field is shown again."],
  impact: { ...emptyImpact, destructive: true, destructiveReasons: ["Hides the “Unit price” field, which 3 rows have data for (the values are kept)."] },
};

const open = (onConfirm = vi.fn()) =>
  render(<ImpactDialog siteId="s" title="Review before publishing" confirmLabel="Publish" request={{ baseVersion: 1, configuration: {} }} onConfirm={onConfirm} onClose={() => undefined} />);

describe("ImpactDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps Publish disabled until the report has loaded, then lists the plain-English changes", async () => {
    let resolve!: (r: ImpactReport) => void;
    vi.mocked(releasesApi.impact).mockReturnValue(new Promise((r) => (resolve = r)));
    open();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    resolve(safe);
    expect(await screen.findByText(/new text field “Shelf”/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("requires an explicit acknowledgement for destructive changes and reports it on confirm", async () => {
    vi.mocked(releasesApi.impact).mockResolvedValue(risky);
    const onConfirm = vi.fn();
    open(onConfirm);
    expect(await screen.findByText(/3 rows keep the saved value/)).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("confirms non-destructive changes without the flag", async () => {
    vi.mocked(releasesApi.impact).mockResolvedValue(safe);
    const onConfirm = vi.fn();
    open(onConfirm);
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("blocks publishing an invalid configuration and shows why", async () => {
    vi.mocked(releasesApi.impact).mockResolvedValue({ valid: false, errors: ["pages.missing-layout: unknown layout"], sentences: [], impact: null });
    open();
    expect(await screen.findByText(/pages.missing-layout/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});

describe("field edits in the builder", () => {
  it("adds, hides and removes fields without mutating the original config", () => {
    const base = configs.central;
    const added = addField(base, { entity: "inventory_item", key: "shelf", label: "Shelf", type: "text", required: false, hidden: false });
    expect(added.fields).toHaveLength(base.fields.length + 1);
    expect(base.fields.some((f) => f.key === "shelf")).toBe(false);
    expect(addField(added, { entity: "inventory_item", key: "shelf", label: "Again", type: "text", required: false, hidden: false })).toBe(added);
    const hidden = updateField(added, "inventory-item-shelf", { hidden: true });
    expect(hidden.fields.find((f) => f.key === "shelf")?.hidden).toBe(true);
    expect(removeField(hidden, "inventory-item-shelf").fields.some((f) => f.key === "shelf")).toBe(false);
  });
});
