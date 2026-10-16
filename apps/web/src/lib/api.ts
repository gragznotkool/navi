import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { ApiError, AuthSession } from "@opshub/contracts";

const BASE = { baseURL: "/api/v1", withCredentials: true, headers: { "x-opshub-client": "web" } };

/** The single HTTP client. Auth is httpOnly cookies, so no token ever touches JS or storage. */
export const http = axios.create(BASE);
/** Interceptor-free client used only to refresh the session (so a failing refresh can never loop). */
const bare = axios.create(BASE);

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiError["details"] = [],
    /** Server-side request id, quotable when reporting a problem. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
  get unavailable(): boolean {
    return this.status === 501;
  }
}

/** Normalises transport and API failures into one user-safe error type. */
export function toRequestError(e: unknown): ApiRequestError {
  if (e instanceof ApiRequestError) return e;
  if (e instanceof AxiosError) {
    const body = e.response?.data as { error?: ApiError } | undefined;
    const headerId = e.response?.headers?.["x-request-id"] as string | undefined;
    if (body?.error) return new ApiRequestError(e.response?.status ?? 0, body.error.code, body.error.message, body.error.details ?? [], body.error.requestId ?? headerId);
    if (!e.response) return new ApiRequestError(0, "network", "Cannot reach the server. Check your connection.");
    return new ApiRequestError(e.response.status, "http_error", `Request failed (${e.response.status})`, [], headerId);
  }
  return new ApiRequestError(0, "unknown", "Something went wrong");
}

export async function call<T>(promise: Promise<{ data: { data: T } }>): Promise<T> {
  try {
    return (await promise).data.data;
  } catch (e) {
    throw toRequestError(e);
  }
}

/** Blob responses carry JSON error bodies as Blobs; decode them so users see the real reason. */
export async function toRequestErrorFromBlob(e: unknown): Promise<ApiRequestError> {
  if (e instanceof AxiosError && e.response?.data instanceof Blob) {
    try {
      const body = JSON.parse(await e.response.data.text()) as { error?: ApiError };
      if (body.error) return new ApiRequestError(e.response.status, body.error.code, body.error.message, body.error.details ?? []);
    } catch {
      /* fall through to the generic mapping */
    }
  }
  return toRequestError(e);
}

/** Hands a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------- session refresh

interface AuthHandlers {
  onRefreshed: (session: AuthSession) => void;
  onAuthFailure: () => void;
}
let handlers: AuthHandlers = { onRefreshed: () => undefined, onAuthFailure: () => undefined };
/** The session store registers itself here (keeps this module free of store imports). */
export function configureAuthHandlers(h: AuthHandlers): void {
  handlers = h;
}

type Tracked = InternalAxiosRequestConfig & { _retried?: boolean; _sentAt?: number };

// These endpoints manage the session themselves: a 401 from them is an answer, not an expiry.
const SESSION_ENDPOINTS = ["/auth/login", "/auth/refresh", "/auth/logout"];

let inflight: Promise<AuthSession> | null = null;
let lastRefreshAt = 0;

/**
 * One refresh at a time, shared by every request that hits a 401 (they queue on the same promise).
 * Refresh tokens are single-use, so across browser tabs a Web Lock serialises refreshes too.
 */
function refreshSession(): Promise<AuthSession> {
  inflight ??= (async () => {
    const run = async () => (await bare.post<{ data: AuthSession }>("/auth/refresh")).data.data;
    try {
      const session = typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request("opshub-refresh", run) : await run();
      lastRefreshAt = Date.now();
      return session;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

http.interceptors.request.use((config) => {
  const c = config as Tracked;
  c._sentAt = Date.now();
  // Lets a support person match a browser action to server logs; the server echoes it back.
  if (!config.headers.has("x-request-id") && typeof crypto !== "undefined" && "randomUUID" in crypto) config.headers.set("x-request-id", crypto.randomUUID());
  return config;
});

http.interceptors.response.use(
  (r) => r,
  async (error: unknown) => {
    const cfg = (error as AxiosError).config as Tracked | undefined;
    const status = (error as AxiosError).response?.status;
    if (status !== 401 || !cfg || cfg._retried || SESSION_ENDPOINTS.some((p) => cfg.url?.startsWith(p))) throw error;
    cfg._retried = true;
    // A request sent before the latest refresh finished simply carried the old cookie: just retry it.
    if (!(cfg._sentAt !== undefined && cfg._sentAt < lastRefreshAt)) {
      try {
        handlers.onRefreshed(await refreshSession());
      } catch {
        handlers.onAuthFailure();
        throw error;
      }
    }
    return http(cfg);
  },
);
