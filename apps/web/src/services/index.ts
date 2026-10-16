import type {
  AuditEvent,
  Assignment,
  AuthSession,
  ConfigurationValidationResult,
  ImportResult,
  ReportAccess,
  CreateRequestPayload,
  DataTypeDefinition,
  ModuleDefinition,
  PaginatedResponse,
  PublishRequest,
  ReleaseDiff,
  ReleaseSummary,
  RequestRecord,
  RollbackRequest,
  SiteConfiguration,
  SiteSummary,
  StockItem,
  TrustCheckResult,
  LoginRequest,
} from "@opshub/contracts";
import { call, http, toRequestErrorFromBlob } from "../lib/api";

export const authApi = {
  login: (body: LoginRequest) => call<AuthSession>(http.post("/auth/login", body)),
  logout: () => http.post("/auth/logout").then(() => undefined),
  me: () => call<AuthSession>(http.get("/auth/me")),
};

export interface ActiveConfig {
  version: number;
  configuration: SiteConfiguration;
}

export const sitesApi = {
  list: () => call<SiteSummary[]>(http.get("/sites")),
  config: (siteId: string) => call<ActiveConfig>(http.get(`/sites/${siteId}/config`)),
  access: (siteId: string) => call<{ id: string; slug: string; roles: string[]; permissions: string[]; activeReleaseVersion: number | null }>(http.get(`/sites/${siteId}`)),
  modules: () => call<ModuleDefinition[]>(http.get("/modules")),
  dataTypes: () => call<DataTypeDefinition[]>(http.get("/modules/data-types")),
};

export interface ItemDetail {
  item: StockItem;
  ledger: { id: string; delta: number; balanceAfter: number; reason: string; createdAt: string }[];
}

export const opsApi = {
  items: (siteId: string, page = 1) => call<PaginatedResponse<StockItem>>(http.get(`/sites/${siteId}/inventory`, { params: { page, pageSize: 50 } })),
  item: (siteId: string, id: string) => call<ItemDetail>(http.get(`/sites/${siteId}/inventory/${id}`)),
  requests: (siteId: string, page = 1) => call<PaginatedResponse<RequestRecord>>(http.get(`/sites/${siteId}/requests`, { params: { page, pageSize: 100 } })),
  createRequest: (siteId: string, body: CreateRequestPayload) => call<RequestRecord>(http.post(`/sites/${siteId}/requests`, body)),
  decide: (siteId: string, id: string, decision: "approved" | "rejected", comment?: string) =>
    call<RequestRecord>(http.post(`/sites/${siteId}/requests/${id}/decision`, { decision, comment })),
  assignments: (siteId: string) => call<Assignment[]>(http.get(`/sites/${siteId}/assignments`)),
  assign: (siteId: string, requestId: string, idempotencyKey: string) =>
    call<Assignment>(http.post(`/sites/${siteId}/assignments`, { requestId }, { headers: { "Idempotency-Key": idempotencyKey } })),
};

export const configApi = {
  validate: (siteId: string, configuration: unknown) => call<ConfigurationValidationResult>(http.post(`/sites/${siteId}/config/validate`, { configuration })),
  preview: (siteId: string, configuration: unknown) => call<{ validation: ConfigurationValidationResult; configuration: SiteConfiguration }>(http.post(`/sites/${siteId}/config/preview`, { configuration })),
  saveDraft: (siteId: string, baseVersion: number | null, configuration: unknown) =>
    call<{ savedAt: string; validation: ConfigurationValidationResult }>(http.put(`/sites/${siteId}/config/draft`, { baseVersion, configuration })),
};

export const releasesApi = {
  list: (siteId: string) => call<ReleaseSummary[]>(http.get(`/sites/${siteId}/releases`)),
  publish: (siteId: string, body: PublishRequest) => call<ReleaseSummary>(http.post(`/sites/${siteId}/releases/publish`, body)),
  rollback: (siteId: string, body: RollbackRequest) => call<ReleaseSummary>(http.post(`/sites/${siteId}/releases/rollback`, body)),
  diff: (siteId: string, releaseId: string) => call<ReleaseDiff>(http.get(`/sites/${siteId}/releases/${releaseId}/diff`)),
  audit: (siteId: string) => call<AuditEvent[]>(http.get(`/sites/${siteId}/audit-events`)),
};

export const trustApi = {
  checks: () => call<{ generatedAt: string | null; checks: TrustCheckResult[] }>(http.get("/trust/checks")),
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const reportsApi = {
  list: (siteId: string) => call<ReportAccess[]>(http.get(`/sites/${siteId}/reports`)),
  /** Returns the workbook bytes; the server has already applied this user's column masking. */
  export: async (siteId: string, key: string): Promise<{ blob: Blob; fileName: string }> => {
    try {
      const res = await http.get<Blob>(`/sites/${siteId}/reports/${key}/export`, { responseType: "blob" });
      return { blob: res.data, fileName: `${key}-report.xlsx` };
    } catch (e) {
      throw await toRequestErrorFromBlob(e);
    }
  },
  import: (siteId: string, key: string, file: File, dryRun: boolean) =>
    call<ImportResult>(
      http.post(`/sites/${siteId}/reports/${key}/import`, file, {
        params: dryRun ? { dryRun: true } : undefined,
        headers: { "Content-Type": XLSX_MIME, "X-File-Name": encodeURIComponent(file.name) },
      }),
    ),
};

export const hubApi = {
  /** Streams a pg_dump custom-format backup (platform admins only). */
  backup: async (): Promise<{ blob: Blob; fileName: string }> => {
    try {
      const res = await http.get<Blob>("/hub/backup", { responseType: "blob" });
      const disposition = String(res.headers["content-disposition"] ?? "");
      return { blob: res.data, fileName: /filename="([^"]+)"/.exec(disposition)?.[1] ?? "opshub-backup.dump" };
    } catch (e) {
      throw await toRequestErrorFromBlob(e);
    }
  },
};
