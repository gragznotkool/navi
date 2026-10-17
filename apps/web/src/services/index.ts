import type {
  AddMemberPayload,
  AdjustStockPayload,
  AnalyticsSummary,
  Assignment,
  AuthSession,
  AuditEvent,
  AiPatchRequest,
  AiPatchResponse,
  ConfigurationValidationResult,
  ConsumptionRecord,
  CreateRepairPayload,
  CreateRequestPayload,
  CreateReturnPayload,
  DataTypeDefinition,
  HubOverviewResponse,
  ImpactReport,
  ImpactRequest,
  ImportReport,
  ImportResult,
  LoginRequest,
  ModuleDefinition,
  PaginatedResponse,
  PresetSummary,
  ProofList,
  ProofResult,
  ProvisionSiteRequest,
  ProvisioningJob,
  ProvisioningSnapshot,
  PublishRequest,
  RecordConsumptionPayload,
  ReleaseDiff,
  ReleaseSummary,
  RepairRecord,
  RepairStatus,
  ReportAccess,
  RequestRecord,
  ReturnRecord,
  ReturnStatus,
  RollbackRequest,
  SiteConfiguration,
  SiteMember,
  SiteSummary,
  StockItem,
  StockSummary,
  TrustCheckResult,
  UpdateItemFieldsPayload,
} from "@opshub/contracts";
import { call, http, toRequestErrorFromBlob } from "../lib/api";
import { cachedRead } from "../lib/offline/engine";

type ActiveConfig = { version: number; configuration: SiteConfiguration };

export const authApi = {
  login: (body: LoginRequest) => call<AuthSession>(http.post("/auth/login", body)),
  logout: () => http.post("/auth/logout").then(() => undefined),
  me: () => call<AuthSession>(http.get("/auth/me")),
};

export const modulesApi = {
  list: () => call<ModuleDefinition[]>(http.get("/modules")),
  dataTypes: () => call<DataTypeDefinition[]>(http.get("/modules/data-types")),
};

export const sitesApi = {
  list: () => call<SiteSummary[]>(http.get("/sites")),
  get: (siteId: string) => call<SiteSummary>(http.get(`/sites/${siteId}`)),
  config: (siteId: string) => cachedRead(siteId, "config", () => call<ActiveConfig>(http.get(`/sites/${siteId}/config`))),
  access: (siteId: string) =>
    cachedRead(siteId, "access", () => call<{ id: string; slug: string; roles: string[]; permissions: string[]; activeReleaseVersion: number | null }>(http.get(`/sites/${siteId}`))),
  modules: () => call<ModuleDefinition[]>(http.get("/modules")),
  dataTypes: () => call<DataTypeDefinition[]>(http.get("/modules/data-types")),
};

export interface ItemDetail {
  item: StockItem;
  ledger: { id: string; delta: number; balanceAfter: number; reason: string; refType: string | null; refId: string | null; createdAt: string }[];
}

export const opsApi = {
  items: (siteId: string, page = 1) => cachedRead(siteId, `items:${page}`, () => call<PaginatedResponse<StockItem>>(http.get(`/sites/${siteId}/inventory`, { params: { page, pageSize: 50 } }))),
  item: (siteId: string, id: string) => call<ItemDetail>(http.get(`/sites/${siteId}/inventory/${id}`)),
  requests: (siteId: string, page = 1) => cachedRead(siteId, `requests:${page}`, () => call<PaginatedResponse<RequestRecord>>(http.get(`/sites/${siteId}/requests`, { params: { page, pageSize: 100 } }))),
  updateItemFields: (siteId: string, id: string, body: UpdateItemFieldsPayload) => call<StockItem>(http.patch(`/sites/${siteId}/inventory/${id}`, body)),
  createRequest: (siteId: string, body: CreateRequestPayload) => call<RequestRecord>(http.post(`/sites/${siteId}/requests`, body)),
  decide: (siteId: string, id: string, decision: "approved" | "rejected", comment?: string) =>
    call<RequestRecord>(http.post(`/sites/${siteId}/requests/${id}/decision`, { decision, comment })),
  assignments: (siteId: string) => cachedRead(siteId, "assignments", () => call<Assignment[]>(http.get(`/sites/${siteId}/assignments`))),
  assign: (siteId: string, requestId: string, idempotencyKey: string) =>
    call<Assignment>(http.post(`/sites/${siteId}/assignments`, { requestId }, { headers: { "Idempotency-Key": idempotencyKey } })),
  recordConsumption: (siteId: string, body: RecordConsumptionPayload) =>
    call<ConsumptionRecord>(http.post(`/sites/${siteId}/consumption`, body)),
  returns: (siteId: string, page = 1) =>
    call<PaginatedResponse<ReturnRecord>>(http.get(`/sites/${siteId}/returns`, { params: { page, pageSize: 100 } })),
  createReturn: (siteId: string, body: CreateReturnPayload) =>
    call<ReturnRecord>(http.post(`/sites/${siteId}/returns`, body)),
  updateReturnStatus: (siteId: string, returnId: string, status: ReturnStatus) =>
    call<ReturnRecord>(http.patch(`/sites/${siteId}/returns/${returnId}/status`, { status })),
  repairs: (siteId: string, page = 1) =>
    call<PaginatedResponse<RepairRecord>>(http.get(`/sites/${siteId}/repairs`, { params: { page, pageSize: 100 } })),
  createRepair: (siteId: string, body: CreateRepairPayload) =>
    call<RepairRecord>(http.post(`/sites/${siteId}/repairs`, body)),
  updateRepairStatus: (siteId: string, repairId: string, status: RepairStatus) =>
    call<RepairRecord>(http.patch(`/sites/${siteId}/repairs/${repairId}/status`, { status })),
  stockSummary: (siteId: string) =>
    call<StockSummary>(http.get(`/sites/${siteId}/analytics/stock-summary`)),
  downloadExcel: async (siteId: string) => {
    const res = await http.get(`/sites/${siteId}/reports/inventory.xlsx`, { responseType: "blob" });
    return res.data as Blob;
  },
  hubOverview: () =>
    call<HubOverviewResponse>(http.get("/hub/overview")),
};

export const configApi = {
  validate: (siteId: string, configuration: SiteConfiguration) =>
    call<ConfigurationValidationResult>(http.post(`/sites/${siteId}/config/validate`, { configuration })),
  preview: (siteId: string, configuration: SiteConfiguration) =>
    call<{ validation: ConfigurationValidationResult; configuration: SiteConfiguration }>(http.post(`/sites/${siteId}/config/preview`, { configuration })),
  draft: (siteId: string) =>
    call<{ baseVersion: number | null; configuration: SiteConfiguration | null; updatedAt: string } | null>(http.get(`/sites/${siteId}/config/draft`)),
  saveDraft: (siteId: string, baseVersion: number | null, configuration: SiteConfiguration) =>
    call<{ savedAt: string; validation: ConfigurationValidationResult }>(http.put(`/sites/${siteId}/config/draft`, { baseVersion, configuration })),
  discardDraft: (siteId: string) =>
    call<{ discarded: boolean }>(http.delete(`/sites/${siteId}/config/draft`)),
};

export const returnsApi = {
  list: (siteId: string) => cachedRead(siteId, "returns", () => call<ReturnRecord[]>(http.get(`/sites/${siteId}/returns`))),
  create: (siteId: string, body: CreateReturnPayload) => call<ReturnRecord>(http.post(`/sites/${siteId}/returns`, body)),
  /** Restocking moves stock, so it carries an idempotency key. */
  transition: (siteId: string, id: string, to: Exclude<ReturnStatus, "initiated">, key?: string) =>
    call<ReturnRecord>(http.post(`/sites/${siteId}/returns/${id}/transition`, { to }, key ? { headers: { "Idempotency-Key": key } } : undefined)),
};

export const repairsApi = {
  list: (siteId: string) => cachedRead(siteId, "repairs", () => call<RepairRecord[]>(http.get(`/sites/${siteId}/repairs`))),
  create: (siteId: string, body: CreateRepairPayload) => call<RepairRecord>(http.post(`/sites/${siteId}/repairs`, body)),
  transition: (siteId: string, id: string, to: RepairStatus) => call<RepairRecord>(http.post(`/sites/${siteId}/repairs/${id}/transition`, { to })),
};

export const stockApi = {
  adjust: (siteId: string, itemId: string, body: AdjustStockPayload, key: string) =>
    call<{ onHand: number }>(http.post(`/sites/${siteId}/inventory/${itemId}/adjust`, body, { headers: { "Idempotency-Key": key } })),
};

export const analyticsApi = {
  summary: (siteId: string) => cachedRead(siteId, "analytics", () => call<AnalyticsSummary>(http.get(`/sites/${siteId}/analytics/summary`))),
};

export const membersApi = {
  list: (siteId: string) => call<SiteMember[]>(http.get(`/sites/${siteId}/members`)),
  add: (siteId: string, body: AddMemberPayload) => call<SiteMember>(http.post(`/sites/${siteId}/members`, body)),
  setRoles: (siteId: string, userId: string, roles: string[]) => call<SiteMember>(http.put(`/sites/${siteId}/members/${userId}`, { roles })),
  remove: (siteId: string, userId: string) => http.delete(`/sites/${siteId}/members/${userId}`).then(() => undefined),
};

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const excelApi = {
  /** Downloads an .xlsx for the site as a Blob. `kind` picks the report. */
  download: (siteId: string, kind: "reports/inventory" | "reports/requests" | "imports/inventory/template") =>
    http.get<Blob>(`/sites/${siteId}/${kind}.xlsx`, { responseType: "blob" }).then((r) => r.data),
  /** Dry run by default: nothing is written unless `apply` is true (which needs an idempotency key). */
  importInventory: (siteId: string, file: File, opts: { apply: boolean; key?: string }) =>
    call<ImportReport>(
      http.post(`/sites/${siteId}/imports/inventory`, file, {
        params: { dryRun: !opts.apply },
        headers: { "content-type": XLSX, ...(opts.key ? { "idempotency-key": opts.key } : {}) },
      }),
    ),
};

export const aiApi = {
  /** Proposes a change from an utterance. Never saves or publishes anything. */
  patch: (siteId: string, body: AiPatchRequest) => call<AiPatchResponse>(http.post(`/sites/${siteId}/ai/patch`, body)),
};

export const releasesApi = {
  list: (siteId: string) => call<ReleaseSummary[]>(http.get(`/sites/${siteId}/releases`)),
  publish: (siteId: string, body: PublishRequest) => call<ReleaseSummary>(http.post(`/sites/${siteId}/releases/publish`, body)),
  rollback: (siteId: string, body: RollbackRequest) => call<ReleaseSummary>(http.post(`/sites/${siteId}/releases/rollback`, body)),
  impact: (siteId: string, body: ImpactRequest) => call<ImpactReport>(http.post(`/sites/${siteId}/releases/impact`, body)),
  get: (siteId: string, releaseId: string) => call<{ release: ReleaseSummary; configuration: SiteConfiguration }>(http.get(`/sites/${siteId}/releases/${releaseId}`)),
  summary: (siteId: string, releaseId: string) => call<{ version: number; sentences: string[] }>(http.get(`/sites/${siteId}/releases/${releaseId}/summary`)),
  diff: (siteId: string, releaseId: string) => call<ReleaseDiff>(http.get(`/sites/${siteId}/releases/${releaseId}/diff`)),
  audit: (siteId: string) => call<AuditEvent[]>(http.get(`/sites/${siteId}/audit-events`)),
  preview: (siteId: string, releaseId: string) => call<{ version: number; configuration: unknown }>(http.get(`/sites/${siteId}/releases/${releaseId}/preview`)),
  rollbackEligibility: (siteId: string, releaseId: string, baseVersion: number) => call<{ eligible: boolean; warnings?: string[]; blockingReasons?: string[] }>(http.get(`/sites/${siteId}/releases/${releaseId}/rollback-eligibility`, { params: { baseVersion } })),
};

export const trustApi = {
  checks: () => call<{ generatedAt: string | null; checks: TrustCheckResult[] }>(http.get("/trust/checks")),
  proofs: () => call<ProofList>(http.get("/trust/proofs")),
  runProof: (id: string) => call<ProofResult>(http.post(`/trust/proofs/${id}/run`)),
  summary: () => call<{ generatedAt: string; isolation: { passed: boolean; detail: string }; inventory: { passed: boolean; detail: string } }>(http.get("/trust/summary")),
  isolationCheck: () => call<{ passed: boolean; detail: string }>(http.get("/trust/isolation-check")),
  inventoryCheck: () => call<{ passed: boolean; detail: string }>(http.get("/trust/inventory-check")),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditEvents: () => call<any[]>(http.get("/trust/audit-events")),
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

export const provisioningApi = {
  presets: () => call<PresetSummary[]>(http.get("/provisioning/presets")),
  start: (body: ProvisionSiteRequest) => call<ProvisioningJob>(http.post("/sites", body)),
  snapshot: (jobId: string, after = 0) => call<ProvisioningSnapshot>(http.get(`/provisioning/${jobId}/events`, { params: { after } })),
};
