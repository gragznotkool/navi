import {
  addMemberPayloadSchema,
  adjustStockPayloadSchema,
  aiPatchRequestSchema,
  configurationPayloadSchema,
  createAssignmentPayloadSchema,
  createRepairPayloadSchema,
  createRequestPayloadSchema,
  createReturnPayloadSchema,
  decideRequestPayloadSchema,
  impactRequestSchema,
  loginRequestSchema,
  provisionSiteRequestSchema,
  publicRequestSchema,
  publishRequestSchema,
  recordConsumptionPayloadSchema,
  rollbackRequestSchema,
  setMemberRolesPayloadSchema,
  syncRequestSchema,
  transitionRepairPayloadSchema,
  transitionReturnPayloadSchema,
  updateItemFieldsPayloadSchema,
} from "@opshub/contracts";
import { z, type ZodType } from "zod";
import type { RouteEntry } from "../routes/manifest.js";

/** Request bodies, keyed by "METHOD /path". Everything else documents its path, method and security only. */
const bodies: Record<string, ZodType> = {
  "POST /api/v1/auth/login": loginRequestSchema,
  "POST /api/v1/sites": provisionSiteRequestSchema,
  "POST /api/v1/sites/{siteId}/config/validate": configurationPayloadSchema,
  "POST /api/v1/sites/{siteId}/config/preview": configurationPayloadSchema,
  "POST /api/v1/sites/{siteId}/releases/impact": impactRequestSchema,
  "POST /api/v1/sites/{siteId}/releases/publish": publishRequestSchema,
  "POST /api/v1/sites/{siteId}/releases/rollback": rollbackRequestSchema,
  "POST /api/v1/sites/{siteId}/ai/patch": aiPatchRequestSchema,
  "POST /api/v1/sites/{siteId}/requests": createRequestPayloadSchema,
  "POST /api/v1/sites/{siteId}/requests/{requestId}/decision": decideRequestPayloadSchema,
  "POST /api/v1/sites/{siteId}/assignments": createAssignmentPayloadSchema,
  "POST /api/v1/sites/{siteId}/consumption": recordConsumptionPayloadSchema,
  "PATCH /api/v1/sites/{siteId}/inventory/{itemId}": updateItemFieldsPayloadSchema,
  "POST /api/v1/sites/{siteId}/inventory/{itemId}/adjust": adjustStockPayloadSchema,
  "POST /api/v1/sites/{siteId}/returns": createReturnPayloadSchema,
  "POST /api/v1/sites/{siteId}/returns/{returnId}/transition": transitionReturnPayloadSchema,
  "POST /api/v1/sites/{siteId}/repairs": createRepairPayloadSchema,
  "POST /api/v1/sites/{siteId}/repairs/{repairId}/transition": transitionRepairPayloadSchema,
  "POST /api/v1/sites/{siteId}/members": addMemberPayloadSchema,
  "PUT /api/v1/sites/{siteId}/members/{userId}": setMemberRolesPayloadSchema,
  "POST /api/v1/sites/{siteId}/sync": syncRequestSchema,
  "POST /api/public/{slug}/requests": publicRequestSchema,
};

/** Routes that need no session. Everything else requires the session cookie. */
const open = new Set(["GET /api/v1/health", "GET /api/v1/ready", "POST /api/v1/auth/login", "POST /api/v1/auth/refresh", "GET /api/v1/openapi.json", "POST /api/public/{slug}/requests"]);

/** Routes that change stock and therefore require an Idempotency-Key header. */
const needsKey = new Set(["POST /api/v1/sites/{siteId}/assignments", "POST /api/v1/sites/{siteId}/inventory/{itemId}/adjust", "POST /api/v1/sites/{siteId}/returns/{returnId}/transition", "POST /api/v1/sites/{siteId}/imports/inventory"]);

/** The one route registered outside `mount`, so it is added by hand. */
export const EXTRA_ROUTES: RouteEntry[] = [{ method: "POST", path: "/api/public/:slug/requests", status: "implemented" }];

const toOpenApiPath = (p: string): string => p.replace(/:([A-Za-z]+)/g, "{$1}");

export function buildOpenApi(routes: readonly RouteEntry[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of [...routes, ...EXTRA_ROUTES]) {
    const path = toOpenApiPath(r.path);
    const method = r.method.toLowerCase();
    const id = `${r.method} ${path}`;
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1]!, in: "path", required: true, schema: { type: "string" } }));
    if (needsKey.has(id)) params.push({ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } } as never);
    const body = bodies[id];
    (paths[path] ??= {})[method] = {
      summary: id,
      ...(r.status === "not-implemented" ? { description: "Documented but not implemented: answers 501.", deprecated: true } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(body, { unrepresentable: "any", io: "input" }) } } } } : {}),
      ...(open.has(id) ? { security: [] } : {}),
      responses: { "2XX": { description: "Success: { data: … }" }, "4XX": { description: "Client error: { error: { code, message, requestId } }" }, ...(r.status === "not-implemented" ? { "501": { description: "Not implemented" } } : {}) },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "OpsHub API", version: "1.0.0", description: "Every route is site-scoped and permission-checked on the server. Mutating routes need the x-opshub-client header." },
    servers: [{ url: "/" }],
    components: { securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "opshub_session" } } },
    security: [{ cookieAuth: [] }],
    paths,
  };
}
