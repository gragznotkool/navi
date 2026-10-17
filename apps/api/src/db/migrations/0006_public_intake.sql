-- Public intake: anonymous visitors may submit a request to a site whose active release enables it.
-- 1) A system account owns those requests. Its password hash is well-formed but unknowable, so nobody can sign in as it.
INSERT INTO users (id, email, display_name, password_hash, is_platform_admin)
VALUES ('00000000-0000-4000-8000-0000000000bb', 'public-intake@system.invalid', 'Public intake (system)',
        '$2b$10$00000000000000000000000000000000000000000000000000000', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- 2) Resolving a site from its public address. The API sets app.public_slug for one transaction; the policy then
--    exposes exactly that one (non-system) site row and nothing else. Without the setting the policy matches no rows.
CREATE POLICY public_slug_lookup ON sites FOR SELECT
  USING (slug = nullif(current_setting('app.public_slug', true), '') AND NOT is_system);
