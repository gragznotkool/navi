import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@opshub/contracts";

const session: AuthSession = {
  user: { id: "10000000-0000-4000-8000-000000000001", email: "a@b.co", displayName: "A", isPlatformAdmin: false },
  memberships: [],
  expiresAt: "2030-01-01T00:00:00.000Z",
};

/** A tiny fake server driven by two flags: is the access cookie valid, and is the refresh cookie valid. */
const server = { accessValid: true, refreshValid: true, calls: [] as { url: string; requestId?: string }[], hold: null as null | Promise<void>, stillRejectAfterRefresh: false };

const reply = (config: InternalAxiosRequestConfig, status: number, body: unknown) => {
  const response = { data: body, status, statusText: String(status), headers: {}, config };
  if (status >= 400) return Promise.reject(new AxiosError(`status ${status}`, "ERR_BAD_REQUEST", config, null, response));
  return Promise.resolve(response);
};

const adapter: AxiosAdapter = async (config) => {
  const url = config.url ?? "";
  server.calls.push({ url, requestId: config.headers.get("x-request-id") as string | undefined });
  if (url === "/auth/refresh") {
    if (!server.refreshValid) return reply(config, 401, { error: { code: "unauthorized", message: "Session expired. Sign in again." } });
    server.accessValid = !server.stillRejectAfterRefresh;
    return reply(config, 200, { data: session });
  }
  if (url === "/auth/login") return reply(config, 401, { error: { code: "unauthorized", message: "Invalid email or password" } });
  if (server.hold) await server.hold;
  if (!server.accessValid) return reply(config, 401, { error: { code: "unauthorized", message: "Invalid or expired session", requestId: "req-from-server-1" } });
  return reply(config, 200, { data: { ok: true, url } });
};

const refreshCalls = () => server.calls.filter((c) => c.url === "/auth/refresh").length;

const originalAdapter = axios.defaults.adapter;
afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

async function load() {
  vi.resetModules();
  axios.defaults.adapter = adapter; // axios.create() copies defaults, so set before the module builds its clients
  const api = await import("../src/lib/api");
  const handlers = { onRefreshed: vi.fn(), onAuthFailure: vi.fn() };
  api.configureAuthHandlers(handlers);
  return { ...api, handlers };
}

beforeEach(() => {
  Object.assign(server, { accessValid: true, refreshValid: true, calls: [], hold: null, stillRejectAfterRefresh: false });
});

describe("transparent session refresh", () => {
  it("passes requests through untouched while the session is valid", async () => {
    const { http, call, handlers } = await load();
    expect(await call(http.get("/sites"))).toEqual({ ok: true, url: "/sites" });
    expect(refreshCalls()).toBe(0);
    expect(handlers.onRefreshed).not.toHaveBeenCalled();
  });

  it("on a 401 it refreshes once, retries the original request and reports the new session", async () => {
    const { http, call, handlers } = await load();
    server.accessValid = false;
    expect(await call(http.get("/sites"))).toEqual({ ok: true, url: "/sites" });
    expect(refreshCalls()).toBe(1);
    expect(server.calls.map((c) => c.url)).toEqual(["/sites", "/auth/refresh", "/sites"]);
    expect(handlers.onRefreshed).toHaveBeenCalledWith(session);
    expect(handlers.onAuthFailure).not.toHaveBeenCalled();
  });

  it("queues concurrent 401s behind a single refresh and retries them all", async () => {
    const { http, call } = await load();
    server.accessValid = false;
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => call(http.get(`/thing/${i}`))));
    expect(results).toHaveLength(5);
    expect(refreshCalls()).toBe(1);
  });

  it("does not refresh again for a request that was already in flight when the last refresh finished", async () => {
    const { http, call } = await load();
    server.accessValid = false;
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    // B is sent first and parked at the server; A triggers the refresh in the meantime.
    const b = call(http.get("/b"));
    await new Promise((r) => setTimeout(r, 5));
    server.hold = null;
    const a = call(http.get("/a"));
    await a;
    await new Promise((r) => setTimeout(r, 5));
    release(); // B now answers 401 (it carried the old cookie), but a refresh already happened since it was sent
    expect(await b).toEqual({ ok: true, url: "/b" });
    expect(refreshCalls()).toBe(1);
  });

  it("when the refresh fails, signals the app to sign out and surfaces the original 401", async () => {
    const { http, call, handlers } = await load();
    server.accessValid = false;
    server.refreshValid = false;
    await expect(call(http.get("/sites"))).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(handlers.onAuthFailure).toHaveBeenCalledTimes(1);
    expect(handlers.onRefreshed).not.toHaveBeenCalled();
  });

  it("never loops: a request that is still 401 after a successful refresh fails after one retry", async () => {
    const { http, call } = await load();
    server.accessValid = false;
    server.stillRejectAfterRefresh = true;
    await expect(call(http.get("/sites"))).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls()).toBe(1);
    expect(server.calls.filter((c) => c.url === "/sites")).toHaveLength(2);
  });

  it("does not try to refresh when logging in with bad credentials", async () => {
    const { http, call } = await load();
    await expect(call(http.post("/auth/login", {}))).rejects.toMatchObject({ status: 401, message: "Invalid email or password" });
    expect(refreshCalls()).toBe(0);
  });
});

describe("request ids", () => {
  it("sends an x-request-id with every request and exposes the server's id on errors", async () => {
    const { http, call } = await load();
    await call(http.get("/sites"));
    expect(server.calls[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);

    server.accessValid = false;
    server.refreshValid = false;
    const err = await call(http.get("/sites")).catch((e: unknown) => e);
    expect(err).toMatchObject({ requestId: "req-from-server-1" });
  });
});
