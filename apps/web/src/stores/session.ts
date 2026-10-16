import { create } from "zustand";
import type { AuthSession, LoginRequest } from "@opshub/contracts";
import { configureAuthHandlers } from "../lib/api";
import { authApi } from "../services";
import { clearLastSite } from "./lastSite";
import { notify } from "./toast";

type Status = "unknown" | "authenticated" | "anonymous";

interface SessionState {
  status: Status;
  session: AuthSession | null;
  restore: () => Promise<void>;
  login: (body: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: "unknown",
  session: null,
  async restore() {
    try {
      set({ session: await authApi.me(), status: "authenticated" });
    } catch {
      // 401 simply means "not signed in"; other failures also leave the user at the login screen.
      set({ session: null, status: "anonymous" });
    }
  },
  async login(body) {
    set({ session: await authApi.login(body), status: "authenticated" });
  },
  async logout() {
    try {
      await authApi.logout();
    } finally {
      clearLastSite();
      set({ session: null, status: "anonymous" });
    }
  },
}));

// The HTTP layer refreshes expired sessions on its own; it reports back here.
configureAuthHandlers({
  onRefreshed: (session) => useSession.setState({ session, status: "authenticated" }),
  onAuthFailure: () => {
    if (useSession.getState().status === "authenticated") notify.info("Your session has ended. Please sign in again.");
    useSession.setState({ session: null, status: "anonymous" });
  },
});
