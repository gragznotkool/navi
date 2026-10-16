import axios, { AxiosError } from "axios";
import type { ApiError } from "@opshub/contracts";

/** The single HTTP client. Auth is an httpOnly cookie, so no token ever touches JS or storage. */
export const http = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: { "x-opshub-client": "web" },
});

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiError["details"] = [],
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
    if (body?.error) return new ApiRequestError(e.response?.status ?? 0, body.error.code, body.error.message, body.error.details ?? []);
    if (!e.response) return new ApiRequestError(0, "network", "Cannot reach the server. Check your connection.");
    return new ApiRequestError(e.response.status, "http_error", `Request failed (${e.response.status})`);
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
