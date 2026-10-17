-- Website access control: a platform administrator, acting inside a site context, may remove that
-- site's memberships (to replace its visitor list). Enforced by the database, not just the API.
GRANT DELETE ON user_site_roles TO opshub_app;
--> statement-breakpoint
CREATE POLICY platform_admin_delete ON user_site_roles FOR DELETE
  USING (site_id = app_site_id() AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_user_id() AND u.is_platform_admin));
