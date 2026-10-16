-- Site user management: the API may add and remove memberships, but only inside the site named by the request context
-- (app.current_site_id). Whether the caller is allowed to manage users is decided by the API from the site's roles;
-- the database guarantees such a change can never touch another site's memberships.
GRANT INSERT, DELETE ON user_site_roles TO opshub_app;
--> statement-breakpoint
CREATE POLICY tenant_member_insert ON user_site_roles FOR INSERT WITH CHECK (site_id = app_site_id());
--> statement-breakpoint
CREATE POLICY tenant_member_delete ON user_site_roles FOR DELETE USING (site_id = app_site_id());
--> statement-breakpoint
-- Housekeeping: expired and long-revoked refresh tokens may be deleted (the API does this opportunistically).
GRANT DELETE ON refresh_tokens TO opshub_app;
--> statement-breakpoint
-- A multi-line return writes one ledger row per item, all referencing the same return: uniqueness is per item.
ALTER TABLE stock_ledger DROP CONSTRAINT stock_ledger_ref_reason_uq;
--> statement-breakpoint
ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_ref_reason_item_uq UNIQUE (ref_type, ref_id, reason, item_id);
--> statement-breakpoint
-- Housekeeping: a site's old idempotency records (older than 30 days) may be deleted by that site's own requests.
GRANT DELETE ON idempotency_keys TO opshub_app;
