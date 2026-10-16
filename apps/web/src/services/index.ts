import type {
  AddMemberPayload,
  AdjustStockPayload,
  AnalyticsSummary,
  CreateRepairPayload,
  CreateReturnPayload,
  RepairRecord,
  RepairStatus,
  ReturnRecord,
  ReturnStatus,
  SiteMember,
  AiPatchRequest,
  AiPatchResponse,
  AuditEvent,
  Assignment,
  AuthSession,
  ConfigurationValidationResult,
  CreateRequestPayload,
  DataTypeDefinition,
  ImportReport,
  ImpactReport,
  ImpactRequest,
  ModuleDefinition,
  PaginatedResponse,
  PresetSummary,
  ProvisionSiteRequest,
  ProvisioningJob,
  ProvisioningSnapshot,
  ProofList,
  ProofResult,
  PublishRequest,
  ReleaseDiff,
  ReleaseSummary,
  RequestRecord,
  RollbackRequest,
  SiteConfiguration,
  SiteSummary,
  StockItem,
  UpdateItemFieldsPayload,
  TrustCheckResult,
  LoginRequest,
} from "@opshub/contracts";
import { call, http } from "../lib/api";
import { cachedRead } from "../lib/offline/engine";

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
  config: (siteId: string) => cachedRead(siteId, "config", () => call<ActiveConfig>(http.get(`/sites/${siteId}/config`))),
  access: (siteId: string) =>
    cachedRead(siteId, "access", () => call<{ id: string; slug: string; roles: string[]; permissions: string[]; activeReleaseVersion: number | null }>(http.get(`/sites/${siteId}`))),
  modules: () => call<ModuleDefinition[]>(http.get("/modules")),
  dataTypes: () => call<DataTypeDefinition[]>(http.get("/modules/data-types")),
};

export interface ItemDetail {
  item: StockItem;
  ledger: { id: string; delta: number; balanceAfter: number; reason: string; createdAt: string }[];
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
};

export const configApi = {
  validate: (siteId: string, configuration: unknown) => call<ConfigurationValidationResult>(http.post(`/sites/${siteId}/config/validate`, { configuration })),
  preview: (siteId: string, configuration: unknown) => call<{ validation: ConfigurationValidationResult; configuration: SiteConfiguration }>(http.post(`/sites/${siteId}/config/preview`, { configuration })),
  saveDraft: (siteId: string, baseVersion: number | null, configuration: unknown) =>
    call<{ savedAt: string; validation: ConfigurationValidationResult }>(http.put(`/sites/${siteId}/config/draft`, { baseVersion, configuration })),
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
};

export const trustApi = {
  checks: () => call<{ generatedAt: string | null; checks: TrustCheckResult[] }>(http.get("/trust/checks")),
  proofs: () => call<ProofList>(http.get("/trust/proofs")),
  runProof: (id: string) => call<ProofResult>(http.post(`/trust/proofs/${id}/run`)),
};

export const provisioningApi = {
  presets: () => call<PresetSummary[]>(http.get("/provisioning/presets")),
  start: (body: ProvisionSiteRequest) => call<ProvisioningJob>(http.post("/sites", body)),
  snapshot: (jobId: string, after = 0) => call<ProvisioningSnapshot>(http.get(`/provisioning/${jobId}/events`, { params: { after } })),
};
