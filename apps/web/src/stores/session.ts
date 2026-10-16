import { create } from "zustand";
import type { AuthSession, LoginRequest } from "@opshub/contracts";
import { authApi } from "../services";

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
      set({ session: null, status: "anonymous" });
    }
  },
}));
