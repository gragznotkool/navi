import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@opshub/contracts";
import { RequireAuth } from "../src/app/App";
import { LoginPage } from "../src/features/auth/LoginPage";
import { clearLastSite, getLastSite, setLastSite } from "../src/stores/lastSite";
import { useSession } from "../src/stores/session";

vi.mock("../src/services", () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
import { authApi } from "../src/services";

const session: AuthSession = {
  user: { id: "10000000-0000-4000-8000-000000000001", email: "a@b.co", displayName: "A", isPlatformAdmin: false },
  memberships: [],
  expiresAt: "2030-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  useSession.setState({ status: "anonymous", session: null });
});

const app = (initial: { pathname: string; state?: unknown }) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><div>HOME</div></RequireAuth>} />
        <Route path="/s/:slug" element={<RequireAuth><div>SITE PAGE</div></RequireAuth>} />
      </Routes>
    </MemoryRouter>,
  );

const signIn = async () => {
  await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
  await userEvent.type(screen.getByLabelText("Password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

describe("return to where you were after signing in again", () => {
  it("sends an unauthenticated visitor to login and back to the page they wanted", async () => {
    vi.mocked(authApi.login).mockResolvedValue(session);
    app({ pathname: "/s/central-stores" });
    expect(await screen.findByRole("heading", { name: "Sign in to OpsHub" })).toBeInTheDocument();
    await signIn();
    expect(await screen.findByText("SITE PAGE")).toBeInTheDocument();
  });

  it("ignores a return path that would leave the app", async () => {
    vi.mocked(authApi.login).mockResolvedValue(session);
    app({ pathname: "/login", state: { from: "//evil.example/steal" } });
    await signIn();
    expect(await screen.findByText("HOME")).toBeInTheDocument();
  });
});

describe("session handling", () => {
  it("a lost session (refresh failed) returns the app to the anonymous state", async () => {
    useSession.setState({ status: "authenticated", session });
    app({ pathname: "/" });
    expect(await screen.findByText("HOME")).toBeInTheDocument();
    // This is the state change the HTTP layer's failure handler makes when a refresh is refused.
    useSession.setState({ session: null, status: "anonymous" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in to OpsHub" })).toBeInTheDocument());
  });

  it("logging out forgets the remembered site", async () => {
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    useSession.setState({ status: "authenticated", session });
    setLastSite("central-stores");
    await useSession.getState().logout();
    expect(getLastSite()).toBeNull();
    expect(useSession.getState().status).toBe("anonymous");
  });
});

describe("last-site memory", () => {
  it("stores, reads and clears the slug", () => {
    expect(getLastSite()).toBeNull();
    setLastSite("distribution");
    expect(getLastSite()).toBe("distribution");
    clearLastSite();
    expect(getLastSite()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getLastSite()).toBeNull();
    spy.mockRestore();
  });
});
