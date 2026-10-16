import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const requestStatus = pgEnum("request_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "assigned",
  "fulfilled",
  "cancelled",
]);
export const approvalDecision = pgEnum("approval_decision", ["approved", "rejected"]);
export const returnStatus = pgEnum("return_status", ["initiated", "inspected", "restocked", "rejected"]);
export const repairStatus = pgEnum("repair_status", [
  "received",
  "diagnosing",
  "repairing",
  "testing",
  "completed",
  "scrapped",
]);
export const ledgerReason = pgEnum("ledger_reason", [
  "opening-balance",
  "assignment",
  "return-restock",
  "adjustment",
]);

// ---------------------------------------------------------------------------
// Global (non-tenant) identity tables. Access is limited by GRANTs, not RLS.
// ---------------------------------------------------------------------------

/** Platform users. `token_version` is bumped on logout/revocation to invalidate issued JWTs. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Role keys referenced by site configuration `roles[].id`. Permissions live in the site config. */
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
});

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Reserved sites (e.g. the Trust Console lab) are excluded from site lists. */
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Tenant-owned tables (all carry site_id and are protected by FORCE RLS).
// ---------------------------------------------------------------------------

export const userSiteRoles = pgTable(
  "user_site_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.siteId, t.roleId] }), index("user_site_roles_site_idx").on(t.siteId)],
);

/** Immutable once inserted (enforced by trigger). Rollback inserts a NEW row; history is never rewritten. */
export const siteReleases = pgTable(
  "site_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    configuration: jsonb("configuration").notNull(),
    note: text("note"),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    rolledBackToVersion: integer("rolled_back_to_version"),
  },
  (t) => [
    unique("site_releases_site_version_uq").on(t.siteId, t.version),
    unique("site_releases_site_id_uq").on(t.siteId, t.id),
    check("site_releases_version_positive", sql`${t.version} >= 1`),
  ],
);

/** One row per site: the single mutable pointer to the active release. */
export const siteActiveReleases = pgTable(
  "site_active_releases",
  {
    siteId: uuid("site_id")
      .primaryKey()
      .references(() => sites.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").notNull(),
    version: integer("version").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Guarantees the pointer references a release of the SAME site.
    foreignKey({
      columns: [t.siteId, t.releaseId],
      foreignColumns: [siteReleases.siteId, siteReleases.id],
      name: "site_active_release_same_site_fk",
    }),
  ],
);

/** Latest unpublished draft per site. `base_version` powers stale-draft (409) detection. */
export const siteDrafts = pgTable("site_drafts", {
  siteId: uuid("site_id")
    .primaryKey()
    .references(() => sites.id, { onDelete: "cascade" }),
  baseVersion: integer("base_version"),
  configuration: jsonb("configuration").notNull(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedAt: updatedAt(),
});

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("each"),
    /** Denormalised balance; reconcilable against SUM(stock_ledger.delta). Never negative (CHECK). */
    onHand: integer("on_hand").notNull().default(0),
    reorderLevel: integer("reorder_level").notNull().default(0),
    /** Values of configurable fields. Hidden fields stay here (soft-hide). */
    extras: jsonb("extras").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("inventory_items_site_sku_uq").on(t.siteId, t.sku),
    unique("inventory_items_site_id_uq").on(t.siteId, t.id),
    check("inventory_items_on_hand_nonneg", sql`${t.onHand} >= 0`),
    check("inventory_items_reorder_nonneg", sql`${t.reorderLevel} >= 0`),
  ],
);

/** Append-only (trigger-enforced). Every stock change writes exactly one row. */
export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    itemId: uuid("item_id").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: ledgerReason("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    /** Active release version when this movement was written. */
    configVersion: integer("config_version"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.siteId, t.itemId],
      foreignColumns: [inventoryItems.siteId, inventoryItems.id],
      name: "stock_ledger_item_same_site_fk",
    }),
    check("stock_ledger_delta_nonzero", sql`${t.delta} <> 0`),
    check("stock_ledger_balance_nonneg", sql`${t.balanceAfter} >= 0`),
    index("stock_ledger_item_created_idx").on(t.itemId, t.createdAt),
    // One assignment/return can create at most one ledger row for a given reason.
    unique("stock_ledger_ref_reason_uq").on(t.refType, t.refId, t.reason),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    status: requestStatus("status").notNull().default("draft"),
    /** Set on every status transition; drives Aging SLA. */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Config release version in force when the request was created (interprets its workflow). */
    releaseVersion: integer("release_version").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("requests_site_id_uq").on(t.siteId, t.id),
    index("requests_site_status_idx").on(t.siteId, t.status, t.createdAt),
  ],
);

/** One row per requested item. A request has one or more lines. */
export const requestLines = pgTable(
  "request_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    requestId: uuid("request_id").notNull(),
    itemId: uuid("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    extras: jsonb("extras").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    unique("request_lines_site_id_uq").on(t.siteId, t.id),
    unique("request_lines_request_item_uq").on(t.requestId, t.itemId),
    foreignKey({
      columns: [t.siteId, t.requestId],
      foreignColumns: [requests.siteId, requests.id],
      name: "request_lines_request_same_site_fk",
    }),
    foreignKey({
      columns: [t.siteId, t.itemId],
      foreignColumns: [inventoryItems.siteId, inventoryItems.id],
      name: "request_lines_item_same_site_fk",
    }),
    check("request_lines_quantity_positive", sql`${t.quantity} > 0`),
    index("request_lines_request_idx").on(t.requestId),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    requestId: uuid("request_id").notNull(),
    decision: approvalDecision("decision").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.siteId, t.requestId],
      foreignColumns: [requests.siteId, requests.id],
      name: "approvals_request_same_site_fk",
    }),
    // A request is decided once.
    unique("approvals_request_uq").on(t.requestId),
    unique("approvals_site_request_uq").on(t.siteId, t.requestId, t.decision),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    requestId: uuid("request_id").notNull(),
    /** Total units across all lines of the request. */
    quantity: integer("quantity").notNull(),
    /** Active release version when assigned. */
    configVersion: integer("config_version"),
    /** Denormalised from the approved request so a row can't exist without an approval (composite FK below). */
    approvedDecision: approvalDecision("approved_decision").notNull().default("approved"),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("assignments_site_id_uq").on(t.siteId, t.id),
    // One assignment per request: retries and double-clicks cannot allocate twice.
    unique("assignments_request_uq").on(t.requestId),
    foreignKey({
      columns: [t.siteId, t.requestId, t.approvedDecision],
      foreignColumns: [approvals.siteId, approvals.requestId, approvals.decision],
      name: "assignments_requires_approval_fk",
    }),
    check("assignments_quantity_positive", sql`${t.quantity} > 0`),
    check("assignments_decision_approved", sql`${t.approvedDecision} = 'approved'`),
  ],
);

export const consumptionRecords = pgTable(
  "consumption_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    quantity: integer("quantity").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.siteId, t.assignmentId],
      foreignColumns: [assignments.siteId, assignments.id],
      name: "consumption_assignment_same_site_fk",
    }),
    check("consumption_quantity_positive", sql`${t.quantity} > 0`),
    index("consumption_assignment_idx").on(t.assignmentId),
  ],
);

export const returnRecords = pgTable(
  "return_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: returnStatus("status").notNull().default("initiated"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.siteId, t.assignmentId],
      foreignColumns: [assignments.siteId, assignments.id],
      name: "returns_assignment_same_site_fk",
    }),
    check("returns_quantity_positive", sql`${t.quantity} > 0`),
    index("returns_assignment_idx").on(t.assignmentId),
  ],
);

export const repairRecords = pgTable(
  "repair_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    boardSerial: text("board_serial").notNull(),
    status: repairStatus("status").notNull().default("received"),
    technicianId: uuid("technician_id").references(() => users.id, { onDelete: "set null" }),
    releaseVersion: integer("release_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("repair_records_site_serial_uq").on(t.siteId, t.boardSerial),
    index("repair_records_site_status_idx").on(t.siteId, t.status),
  ],
);

/** Append-only (trigger-enforced). `site_id` is null only for platform-level events such as failed logins. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    requestId: text("request_id"),
    configVersion: integer("config_version"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_site_created_idx").on(t.siteId, t.createdAt)],
);

/** Per-site idempotency records for retried mutations. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.key] })],
);

// ---------------------------------------------------------------------------
// Global platform tables (no tenant column; access controlled by GRANTs).
// ---------------------------------------------------------------------------

/** Rotating refresh tokens. Only the SHA-256 hash is stored; `family_id` lets reuse detection revoke a whole chain. */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    createdAt: createdAt(),
  },
  (t) => [index("refresh_tokens_user_idx").on(t.userId), index("refresh_tokens_family_idx").on(t.familyId)],
);

export const provisioningStatus = pgEnum("provisioning_status", ["running", "succeeded", "failed"]);

export const provisioningJobs = pgTable("provisioning_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  status: provisioningStatus("status").notNull().default("running"),
  input: jsonb("input").notNull(),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const provisioningEvents = pgTable(
  "provisioning_events",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => provisioningJobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.seq] })],
);
