-- APEX 10.3/11.0 evidence tables were created without RLS enabled, flagged
-- by the Supabase security linter (rls_disabled_in_public, ERROR level).
-- These tables are server-only (accessed via the service-role key in
-- supabaseServer()), so enabling RLS with no policies blocks anon/
-- authenticated browser-key access entirely while service-role continues
-- to work unimpeded -- same pattern already used for crawler_runs.
alter table if exists image_evidence_jobs enable row level security;
alter table if exists evidence_snapshots enable row level security;
alter table if exists evidence_queue enable row level security;
