import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiPatchResponse } from "@opshub/contracts";
import { BoloBuildPanel } from "../src/features/builder/BoloBuildPanel";
import { ApiRequestError } from "../src/lib/api";
import { speechErrorMessage } from "../src/lib/speech";
import { configs } from "./helpers";

vi.mock("../src/services", () => ({ aiApi: { patch: vi.fn() } }));
vi.mock("../src/lib/speech", async (orig) => ({ ...(await orig<typeof import("../src/lib/speech")>()), speechSupported: vi.fn(() => true), listen: vi.fn() }));
import { listen, speechSupported } from "../src/lib/speech";
import { aiApi } from "../src/services";

const cfg = configs.distribution;
const base: AiPatchResponse = {
  source: "fallback",
  provider: "built-in demo phrases",
  fallbackReason: "No AI key is configured on the server.",
  patch: { ops: [{ op: "add-module", moduleType: "return-management" }] },
  configuration: { ...cfg, name: "PATCHED" },
  validation: { valid: true, errors: [], warnings: [] },
  sentences: ["A new “Return Management” module is added, with a new “Returns” tab."],
  impact: null,
  skipped: [],
  message: null,
  published: false,
};
const onApply = vi.fn();
const mount = () => render(<BoloBuildPanel siteId={cfg.siteId} config={cfg} onApply={onApply} />);
const propose = async (words = "add return management") => {
  await userEvent.type(screen.getByLabelText("What should change?"), words);
  await userEvent.click(screen.getByRole("button", { name: "Propose change" }));
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(speechSupported).mockReturnValue(true);
});

describe("Bolo & Build panel", () => {
  it("sends the words with the language and the current draft, and shows a clearly labelled fallback proposal", async () => {
    vi.mocked(aiApi.patch).mockResolvedValue(base);
    mount();
    await userEvent.selectOptions(screen.getByLabelText("Language"), "hi-IN");
    await propose();
    expect(aiApi.patch).toHaveBeenCalledWith(cfg.siteId, { utterance: "add return management", lang: "hi-IN", configuration: cfg });
    const box = await screen.findByLabelText("Proposed change");
    expect(box).toHaveTextContent("Built-in fallback");
    expect(box).toHaveTextContent("No AI key is configured on the server.");
    expect(screen.getByRole("list", { name: "What this would change" })).toHaveTextContent("Return Management");
    expect(onApply).not.toHaveBeenCalled(); // proposing never changes the draft
  });

  it("labels a model answer as an AI proposal", async () => {
    vi.mocked(aiApi.patch).mockResolvedValue({ ...base, source: "model", provider: "gemini:gemini-2.5-flash", fallbackReason: null });
    mount();
    await propose();
    expect(await screen.findByText("AI proposal")).toBeInTheDocument();
    expect(screen.queryByText("Built-in fallback")).not.toBeInTheDocument();
  });

  it("applies to the draft only when the user presses Apply, then clears the proposal", async () => {
    vi.mocked(aiApi.patch).mockResolvedValue(base);
    mount();
    await propose();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to draft" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ name: "PATCHED" }));
    expect(screen.queryByLabelText("Proposed change")).not.toBeInTheDocument();
  });

  it("will not apply a proposal the server found invalid, and shows why", async () => {
    vi.mocked(aiApi.patch).mockResolvedValue({ ...base, validation: { valid: false, warnings: [], errors: [{ severity: "error", stage: "dependencies", code: "dependencies.missing", message: "“approval” requires “request”" }] } });
    mount();
    await propose("remove requests");
    expect(await screen.findByRole("alert", { name: "Problems" })).toHaveTextContent("requires");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
  });

  it("shows ops that were refused and does not offer to apply when nothing applied", async () => {
    vi.mocked(aiApi.patch).mockResolvedValue({
      ...base,
      patch: { ops: [{ op: "grant-permission", role: "dispatcher", permission: "config:manage" }] },
      skipped: [{ op: "grant-permission", reason: "“config:manage” can only be granted deliberately in the builder, not by an instruction." }],
      message: "Nothing could be applied: nope",
    });
    mount();
    await propose("make dispatcher boss");
    expect(await screen.findByRole("list", { name: "Not applied" })).toHaveTextContent("deliberately in the builder");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
  });

  it("explains when no patch could be made, and reports server errors without crashing", async () => {
    vi.mocked(aiApi.patch).mockResolvedValueOnce({ ...base, patch: null, configuration: null, validation: null, sentences: [], message: "I could not turn that into a change." });
    mount();
    await propose("weather?");
    expect(await screen.findByRole("status")).toHaveTextContent("could not turn that into a change");
    expect(screen.queryByRole("button", { name: "Apply to draft" })).not.toBeInTheDocument();

    vi.mocked(aiApi.patch).mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "Too many AI requests. Wait a minute and try again."));
    await userEvent.click(screen.getByRole("button", { name: "Propose change" }));
    expect(await screen.findByText("Too many AI requests. Wait a minute and try again.")).toBeInTheDocument();
  });

  it("needs some words before it will ask", () => {
    mount();
    expect(screen.getByRole("button", { name: "Propose change" })).toBeDisabled();
  });
});

describe("voice input", () => {
  it("fills the editable box from speech in the chosen language and sends nothing until Propose is pressed", async () => {
    let handlers!: Parameters<typeof listen>[1];
    const stop = vi.fn();
    vi.mocked(listen).mockImplementation((_lang, h) => {
      handlers = h;
      return { stop };
    });
    vi.mocked(aiApi.patch).mockResolvedValue(base);
    mount();
    await userEvent.selectOptions(screen.getByLabelText("Language"), "mr-IN");
    await userEvent.click(screen.getByRole("button", { name: /Speak/ }));
    expect(listen).toHaveBeenCalledWith("mr-IN", expect.any(Object));
    expect(screen.getByRole("button", { name: /Stop/ })).toHaveAttribute("aria-pressed", "true");

    act(() => handlers.onText("रिटर्न मॉड्यूल जोडा"));
    expect(screen.getByLabelText("What should change?")).toHaveValue("रिटर्न मॉड्यूल जोडा");
    expect(aiApi.patch).not.toHaveBeenCalled();
    act(() => handlers.onEnd(null));
    await waitFor(() => expect(screen.getByRole("button", { name: /Speak/ })).toBeInTheDocument());

    // The transcript can be corrected before sending.
    await userEvent.type(screen.getByLabelText("What should change?"), " आता");
    await userEvent.click(screen.getByRole("button", { name: "Propose change" }));
    expect(aiApi.patch).toHaveBeenCalledWith(cfg.siteId, expect.objectContaining({ utterance: "रिटर्न मॉड्यूल जोडा आता", lang: "mr-IN" }));
  });

  it("Stop ends the session, and a voice error is shown in plain language", async () => {
    let handlers!: Parameters<typeof listen>[1];
    const stop = vi.fn();
    vi.mocked(listen).mockImplementation((_l, h) => {
      handlers = h;
      return { stop };
    });
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Speak/ }));
    await userEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(stop).toHaveBeenCalled();
    act(() => handlers.onEnd(speechErrorMessage("not-allowed")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Microphone access was blocked");
  });

  it("when the browser has no speech support the mic is disabled and typing still works", async () => {
    vi.mocked(speechSupported).mockReturnValue(false);
    vi.mocked(aiApi.patch).mockResolvedValue(base);
    mount();
    expect(screen.getByRole("button", { name: /Speak/ })).toBeDisabled();
    expect(screen.getByText(/Voice input is not available in this browser/)).toBeInTheDocument();
    await propose();
    expect(aiApi.patch).toHaveBeenCalled();
  });

  it("a start failure leaves the mic usable", async () => {
    vi.mocked(listen).mockReturnValue(null);
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Speak/ }));
    expect(screen.getByRole("button", { name: /Speak/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("maps browser speech errors to messages", () => {
    expect(speechErrorMessage("network")).toMatch(/internet connection/);
    expect(speechErrorMessage("no-speech")).toMatch(/did not hear/);
    expect(speechErrorMessage("aborted")).toBe("");
    expect(speechErrorMessage("whatever")).toMatch(/did not work/);
  });
});
