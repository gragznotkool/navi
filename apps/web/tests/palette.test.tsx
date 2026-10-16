import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@opshub/contracts";
import { CommandPalette } from "../src/features/palette/CommandPalette";
import { searchCommands } from "../src/features/palette/search";
import { usePalette } from "../src/stores/palette";
import { useSession } from "../src/stores/session";

vi.mock("../src/services", () => ({ authApi: { login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), me: vi.fn() } }));
import { authApi } from "../src/services";

const session = (admin: boolean): AuthSession => ({
  user: { id: "10000000-0000-4000-8000-000000000001", email: "a@opshub.local", displayName: "A", isPlatformAdmin: admin },
  memberships: [
    { siteId: "10000000-0000-4000-8000-0000000000a1", siteSlug: "central-stores", roles: ["admin"], permissions: ["config:manage", "inventory:view"] },
    { siteId: "10000000-0000-4000-8000-0000000000a2", siteSlug: "distribution", roles: ["viewer"], permissions: ["inventory:view"] },
  ],
  expiresAt: "2030-01-01T00:00:00.000Z",
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/hub"]}>
      <CommandPalette />
      <input aria-label="some field" />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  usePalette.setState({ open: false, siteCommands: [] });
  useSession.setState({ status: "authenticated", session: session(true) });
});

describe("Ctrl+K palette", () => {
  it("opens from anywhere (even inside a form field), focuses the search box and closes with Escape", async () => {
    mount();
    await userEvent.click(screen.getByLabelText("some field"));
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", { name: "Search commands" });
    expect(box).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("some field")).toHaveFocus(); // focus returns to where the user was
  });

  it("Ctrl+K again toggles it closed, and it never opens for a signed-out user", async () => {
    mount();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    useSession.setState({ status: "anonymous", session: null });
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters, moves with the arrow keys (aria-activedescendant) and runs the highlighted command with Enter", async () => {
    mount();
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox");
    await userEvent.type(box, "switch");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Switch to central-stores", "Switch to distribution"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", options[1]!.id);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/s/distribution"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("wraps around, shows an empty state, and Tab does not leave the palette", async () => {
    mount();
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox");
    await userEvent.keyboard("{ArrowUp}");
    const all = screen.getAllByRole("option");
    expect(all.at(-1)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Tab}");
    expect(box).toHaveFocus();
    await userEvent.type(box, "zzzzzz");
    expect(screen.getByText("No matching commands.")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}"); // nothing to run; must not throw or navigate
    expect(screen.getByTestId("where")).toHaveTextContent("/hub");
  });

  it("only offers administrator commands to platform admins, and builder links only where config:manage is held", async () => {
    mount();
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    const names = () => screen.getAllByRole("option").map((o) => o.textContent);
    expect(names()).toContain("Create a new site");
    expect(names()).toContain("Trust console");
    expect(names()).toContain("Open builder for central-stores");
    expect(names()).not.toContain("Open builder for distribution");
    await userEvent.keyboard("{Escape}");

    useSession.setState({ session: session(false) });
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    expect(names()).not.toContain("Create a new site");
    expect(names()).not.toContain("Trust console");
  });

  it("includes the current site's pages, and runs actions such as Sign out", async () => {
    usePalette.setState({ siteCommands: [{ id: "go:/s/central-stores/requests", label: "Central Stores: Requests", group: "Go to", to: "/s/central-stores/requests" }] });
    mount();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox"), "requests");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/s/central-stores/requests"));

    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox"), "sign out");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(authApi.logout).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/login"));
  });
});

describe("searchCommands", () => {
  const cmds = [
    { id: "1", label: "Go to Requests", group: "Go to" as const },
    { id: "2", label: "Requests are great", group: "Go to" as const, keywords: "orders" },
    { id: "3", label: "Sign out", group: "Actions" as const, keywords: "log out" },
  ];
  it("requires every word, matches keywords, and ranks word-starts first", () => {
    expect(searchCommands(cmds, "").length).toBe(3);
    expect(searchCommands(cmds, "log").map((c) => c.id)).toEqual(["3"]);
    expect(searchCommands(cmds, "orders requests").map((c) => c.id)).toEqual(["2"]);
    expect(searchCommands(cmds, "req").map((c) => c.id)).toEqual(["2", "1"]); // label starting with the word wins
    expect(searchCommands(cmds, "REQUESTS   GO").map((c) => c.id)).toEqual(["1"]);
  });
  it("treats regex characters literally", () => {
    expect(searchCommands(cmds, ".*")).toEqual([]);
    expect(searchCommands(cmds, "(")).toEqual([]);
  });
});
