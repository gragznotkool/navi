CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('opening-balance', 'assignment', 'return-restock', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."repair_status" AS ENUM('received', 'diagnosing', 'repairing', 'testing', 'completed', 'scrapped');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'assigned', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('initiated', 'inspected', 'restocked', 'rejected');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"decided_by" uuid NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_request_uq" UNIQUE("request_id"),
	CONSTRAINT "approvals_site_request_uq" UNIQUE("site_id","request_id","decision")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"approved_decision" "approval_decision" DEFAULT 'approved' NOT NULL,
	"assigned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_site_id_uq" UNIQUE("site_id","id"),
	CONSTRAINT "assignments_request_uq" UNIQUE("request_id"),
	CONSTRAINT "assignments_quantity_positive" CHECK ("assignments"."quantity" > 0),
	CONSTRAINT "assignments_decision_approved" CHECK ("assignments"."approved_decision" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumption_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_quantity_positive" CHECK ("consumption_records"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"site_id" uuid NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_site_id_key_pk" PRIMARY KEY("site_id","key")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_site_sku_uq" UNIQUE("site_id","sku"),
	CONSTRAINT "inventory_items_site_id_uq" UNIQUE("site_id","id"),
	CONSTRAINT "inventory_items_on_hand_nonneg" CHECK ("inventory_items"."on_hand" >= 0),
	CONSTRAINT "inventory_items_reorder_nonneg" CHECK ("inventory_items"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repair_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"board_serial" text NOT NULL,
	"status" "repair_status" DEFAULT 'received' NOT NULL,
	"technician_id" uuid,
	"release_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_records_site_serial_uq" UNIQUE("site_id","board_serial")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"release_version" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_site_id_uq" UNIQUE("site_id","id"),
	CONSTRAINT "requests_quantity_positive" CHECK ("requests"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "return_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "return_status" DEFAULT 'initiated' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_quantity_positive" CHECK ("return_records"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "site_active_releases" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_drafts" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"base_version" integer,
	"configuration" jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"note" text,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_to_version" integer,
	CONSTRAINT "site_releases_site_version_uq" UNIQUE("site_id","version"),
	CONSTRAINT "site_releases_site_id_uq" UNIQUE("site_id","id"),
	CONSTRAINT "site_releases_version_positive" CHECK ("site_releases"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledger_ref_reason_uq" UNIQUE("ref_type","ref_id","reason"),
	CONSTRAINT "stock_ledger_delta_nonzero" CHECK ("stock_ledger"."delta" <> 0),
	CONSTRAINT "stock_ledger_balance_nonneg" CHECK ("stock_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_site_roles" (
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_site_roles_user_id_site_id_role_id_pk" PRIMARY KEY("user_id","site_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_request_same_site_fk" FOREIGN KEY ("site_id","request_id") REFERENCES "public"."requests"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_requires_approval_fk" FOREIGN KEY ("site_id","request_id","approved_decision") REFERENCES "public"."approvals"("site_id","request_id","decision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_item_same_site_fk" FOREIGN KEY ("site_id","item_id") REFERENCES "public"."inventory_items"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_records" ADD CONSTRAINT "consumption_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_records" ADD CONSTRAINT "consumption_assignment_same_site_fk" FOREIGN KEY ("site_id","assignment_id") REFERENCES "public"."assignments"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_records" ADD CONSTRAINT "repair_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_records" ADD CONSTRAINT "repair_records_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_item_same_site_fk" FOREIGN KEY ("site_id","item_id") REFERENCES "public"."inventory_items"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_records" ADD CONSTRAINT "return_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_records" ADD CONSTRAINT "returns_assignment_same_site_fk" FOREIGN KEY ("site_id","assignment_id") REFERENCES "public"."assignments"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_active_releases" ADD CONSTRAINT "site_active_releases_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_active_releases" ADD CONSTRAINT "site_active_release_same_site_fk" FOREIGN KEY ("site_id","release_id") REFERENCES "public"."site_releases"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_drafts" ADD CONSTRAINT "site_drafts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_drafts" ADD CONSTRAINT "site_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_releases" ADD CONSTRAINT "site_releases_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_releases" ADD CONSTRAINT "site_releases_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_same_site_fk" FOREIGN KEY ("site_id","item_id") REFERENCES "public"."inventory_items"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_roles" ADD CONSTRAINT "user_site_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_roles" ADD CONSTRAINT "user_site_roles_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_roles" ADD CONSTRAINT "user_site_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_site_created_idx" ON "audit_events" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "consumption_assignment_idx" ON "consumption_records" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "repair_records_site_status_idx" ON "repair_records" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "requests_site_status_idx" ON "requests" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "returns_assignment_idx" ON "return_records" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_item_created_idx" ON "stock_ledger" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "user_site_roles_site_idx" ON "user_site_roles" USING btree ("site_id");