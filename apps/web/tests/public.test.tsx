import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicRequestPage } from "../src/features/public/PublicRequestPage";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/public/distribution/request"]}>
      <Routes>
        <Route path="/public/:slug/request" element={<PublicRequestPage />} />
      </Routes>
    </MemoryRouter>,
  );
const reply = (status: number, body: unknown = {}) => fetchMock.mockResolvedValue({ status, json: async () => body });
const fill = async (sku = "BRG-6204", qty = "2") => {
  await userEvent.type(screen.getByLabelText("Item code 1"), sku);
  await userEvent.clear(screen.getByLabelText("Quantity"));
  await userEvent.type(screen.getByLabelText("Quantity"), qty);
};

describe("public request form", () => {
  it("sends only the whitelisted fields to the public endpoint, with no credentials, and confirms without details", async () => {
    reply(202, { data: { accepted: true } });
    mount();
    await fill();
    await userEvent.type(screen.getByLabelText("Note (optional)"), "for Tuesday");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("heading", { name: "Request received" })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/public/distribution/requests");
    expect((init as RequestInit).credentials).toBeUndefined();
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ lines: [{ sku: "BRG-6204", quantity: 2 }], note: "for Tuesday" });
    expect(screen.queryByText(/BRG-6204/)).not.toBeInTheDocument(); // nothing echoed back
  });

  it("validates in the browser with the shared schema before sending anything", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an item code");
    await fill("bad code!", "1");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Item codes use letters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds and removes lines (at most 5)", async () => {
    mount();
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Add another item" }));
    expect(screen.getByLabelText("Item code 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add another item" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove item 5" }));
    expect(screen.queryByLabelText("Item code 5")).not.toBeInTheDocument();
  });

  it.each([
    [404, {}, "This form is not available."],
    [429, {}, "Too many submissions"],
    [422, { error: { message: "One of the items is not available." } }, "One of the items is not available."],
  ])("explains a %s response plainly", async (status, body, text) => {
    reply(status, body);
    mount();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("explains a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    mount();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("keeps the honeypot out of reach of people and assistive technology", () => {
    mount();
    const trap = screen.getByLabelText("Website", { selector: "input", exact: true, ignore: "none" } as never);
    expect(trap.closest("[aria-hidden]")).not.toBeNull();
    expect(trap).toHaveAttribute("tabindex", "-1");
  });

  it("'Send another' resets the form", async () => {
    reply(202);
    mount();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send another" }));
    await waitFor(() => expect(screen.getByLabelText("Item code 1")).toHaveValue(""));
  });
});
