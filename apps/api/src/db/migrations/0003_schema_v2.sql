-- Schema pass v2: request lines, status_changed_at, config_version, extras, refresh tokens, provisioning, system sites.

ALTER TABLE "sites" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "extras" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "config_version" integer;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "config_version" integer;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "config_version" integer;
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE "request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "request_lines_site_id_uq" UNIQUE("site_id","id"),
	CONSTRAINT "request_lines_request_item_uq" UNIQUE("request_id","item_id"),
	CONSTRAINT "request_lines_quantity_positive" CHECK ("request_lines"."quantity" > 0)
);
--> statement-breakpoint
-- Carry existing single-item requests over as one line each.
INSERT INTO "request_lines" ("site_id", "request_id", "item_id", "quantity") SELECT "site_id", "id", "item_id", "quantity" FROM "requests";
--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_item_same_site_fk";
--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_quantity_positive";
--> statement-breakpoint
ALTER TABLE "requests" DROP COLUMN "item_id";
--> statement-breakpoint
ALTER TABLE "requests" DROP COLUMN "quantity";
--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_item_same_site_fk";
--> statement-breakpoint
ALTER TABLE "assignments" DROP COLUMN "item_id";
--> statement-breakpoint
ALTER TABLE "request_lines" ADD CONSTRAINT "request_lines_request_same_site_fk" FOREIGN KEY ("site_id","request_id") REFERENCES "public"."requests"("site_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "request_lines" ADD CONSTRAINT "request_lines_item_same_site_fk" FOREIGN KEY ("site_id","item_id") REFERENCES "public"."inventory_items"("site_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "request_lines_request_idx" ON "request_lines" USING btree ("request_id");
--> statement-breakpoint
ALTER TABLE "request_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "request_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON request_lines USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON request_lines TO opshub_app;
--> statement-breakpoint

CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");
--> statement-breakpoint
CREATE TYPE "public"."provisioning_status" AS ENUM('running', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE "provisioning_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" "provisioning_status" DEFAULT 'running' NOT NULL,
	"input" jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_jobs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "provisioning_events" (
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_events_job_id_seq_pk" PRIMARY KEY("job_id","seq")
);
--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "provisioning_events" ADD CONSTRAINT "provisioning_events_job_id_provisioning_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."provisioning_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON refresh_tokens, provisioning_jobs TO opshub_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON provisioning_events TO opshub_app;
