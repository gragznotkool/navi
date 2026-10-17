import { z } from "zod";

export const uuid = z.string().uuid();
export const isoTimestamp = z.string().datetime({ offset: true });

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.array(z.object({ path: z.string(), message: z.string(), row: z.number().int().optional(), column: z.string().optional() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiResponse<T> = { data: T; error?: undefined } | { data?: undefined; error: ApiError };

export const paginationRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationRequest = z.infer<typeof paginationRequestSchema>;

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  time: isoTimestamp,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readyResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({ database: z.enum(["ok", "unavailable"]) }),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
