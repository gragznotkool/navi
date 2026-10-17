-- 0007_configuration_proposals.sql: Proposals table with RLS, least-privilege grants, and indexing

DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM (
    'draft',
    'generated',
    'validated',
    'pending_approval',
    'approved',
    'rejected',
    'published'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS configuration_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL,
  prompt text NOT NULL,
  status proposal_status NOT NULL DEFAULT 'generated',
  base_version integer,
  proposed_configuration jsonb NOT NULL,
  configuration_hash text NOT NULL,
  affected_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamp with time zone,
  published_release_version integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS config_proposals_site_idx ON configuration_proposals(site_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS config_proposals_status_idx ON configuration_proposals(status);
--> statement-breakpoint

-- Enable Row-Level Security
ALTER TABLE configuration_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE configuration_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS Policy: Users can only select or manage proposals for sites they belong to
CREATE POLICY proposal_tenant_isolation ON configuration_proposals
  USING (site_id = app_site_id())
  WITH CHECK (site_id = app_site_id());
--> statement-breakpoint

-- Grants for application role
GRANT SELECT, INSERT, UPDATE, DELETE ON configuration_proposals TO opshub_app;
