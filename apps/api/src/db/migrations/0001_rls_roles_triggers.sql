-- Custom migration: tenant isolation (RLS), least-privilege grants, immutability triggers.
-- Assumes the role `opshub_app` already exists (created by src/db/migrate.ts: LOGIN, NOSUPERUSER, NOBYPASSRLS).

-- Transaction-scoped tenant context helpers. Missing/empty setting => NULL => no rows match.
CREATE FUNCTION app_site_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.current_site_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-Level Security on every tenant-owned table (FORCE applies it to the table owner too;
-- superusers / BYPASSRLS roles, i.e. the migration/seed admin, are the only exemption).
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inventory_items USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_ledger USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON requests USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON approvals USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON assignments USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE consumption_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consumption_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON consumption_records USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE return_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE return_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON return_records USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE repair_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE repair_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON repair_records USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE site_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE site_releases FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON site_releases USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE site_active_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE site_active_releases FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON site_active_releases USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE site_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE site_drafts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON site_drafts USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON idempotency_keys USING (site_id = app_site_id()) WITH CHECK (site_id = app_site_id());
--> statement-breakpoint

-- Memberships: a user may read their own memberships in any site; a site context sees its own members.
ALTER TABLE user_site_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_site_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_read ON user_site_roles FOR SELECT
  USING (user_id = app_user_id() OR site_id = app_site_id());
--> statement-breakpoint

-- Sites: visible when it is the current site or the current user is a member.
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_visibility ON sites FOR SELECT
  USING (id = app_site_id() OR id IN (SELECT site_id FROM user_site_roles WHERE user_id = app_user_id()));
--> statement-breakpoint

-- Audit events: readable only inside their own site; inserts allowed for the current site or as platform-level (NULL site).
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_read ON audit_events FOR SELECT USING (site_id = app_site_id());
--> statement-breakpoint
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (site_id IS NULL OR site_id = app_site_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Immutability / append-only enforcement (applies to everyone, including the owner).
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION '% on % is not permitted (append-only / immutable)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation'; END $$;
--> statement-breakpoint
CREATE TRIGGER site_releases_immutable BEFORE UPDATE OR DELETE ON site_releases FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON stock_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- Reconciliation: stock summary vs. ledger. security_invoker makes RLS apply to the caller.
CREATE VIEW stock_reconciliation WITH (security_invoker = true) AS
  SELECT i.site_id, i.id AS item_id, i.sku, i.on_hand,
         COALESCE(SUM(l.delta), 0)::integer AS ledger_sum,
         (i.on_hand = COALESCE(SUM(l.delta), 0)) AS reconciled
  FROM inventory_items i LEFT JOIN stock_ledger l ON l.item_id = i.id
  GROUP BY i.site_id, i.id, i.sku, i.on_hand;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the application role. No DDL, no DELETE anywhere.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM opshub_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO opshub_app;
--> statement-breakpoint
GRANT SELECT ON users, roles, sites, user_site_roles, stock_reconciliation TO opshub_app;
--> statement-breakpoint
GRANT UPDATE (token_version, updated_at) ON users TO opshub_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON site_releases, stock_ledger, approvals, assignments, consumption_records, audit_events TO opshub_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON site_active_releases, site_drafts, inventory_items, requests, return_records, repair_records, idempotency_keys TO opshub_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_site_id(), app_user_id() TO opshub_app;
