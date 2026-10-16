import type { ApiError } from "@opshub/contracts";

/** Errors that are safe to show to clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiError["details"],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: ApiError["details"]) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "Not found") => new AppError(404, "not_found", message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const notImplemented = (feature: string) =>
  new AppError(501, "not_implemented", `${feature} is not implemented yet`);

export function toApiError(err: unknown, requestId: string | undefined): { status: number; body: ApiError } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { code: err.code, message: err.message, ...(requestId ? { requestId } : {}), ...(err.details ? { details: err.details } : {}) },
    };
  }
  return {
    status: 500,
    body: { code: "internal_error", message: "An unexpected error occurred", ...(requestId ? { requestId } : {}) },
  };
}
