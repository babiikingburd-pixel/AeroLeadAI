-- RLS for the six tables created by the APEX 9.9 / 10.0 migrations.
--
-- 20260805_apex99_fusion.sql and 20260805_apex100_autonomous_governance.sql
-- create these tables but never enable row level security. Supabase grants
-- anon and authenticated full DML on every new table in `public` by default,
-- so with RLS off all six are readable AND writable by anyone holding the
-- publishable key, through /rest/v1/. The database linter reports each one as
-- an ERROR (0013_rls_disabled_in_public).
--
-- twincities_apex_controls is the worst of the six: it is the leaderboard
-- engine's kill switch and promotion thresholds. Anonymous UPDATE on that row
-- is enough to disable the engine or drop every promotion gate to zero.
--
-- Read access follows the convention already used by evidence_events,
-- score_history and twincities_validation_jobs in this project (readable with
-- the publishable key — the dashboards run client-side). Writes are
-- service-role only: every writer is a server route using supabaseServer(),
-- or apex10_rebuild_leaderboard() itself, and none of them run as anon.

alter table twincities_apex_cycles            enable row level security;
alter table twincities_apex_decisions         enable row level security;
alter table twincities_apex_controls          enable row level security;
alter table twincities_challengers            enable row level security;
alter table twincities_fusion_events          enable row level security;
alter table twincities_leaderboard_snapshots  enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'twincities_apex_cycles',
    'twincities_apex_decisions',
    'twincities_apex_controls',
    'twincities_challengers',
    'twincities_fusion_events',
    'twincities_leaderboard_snapshots'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select using (true)', t || '_read', t);

    -- service_role bypasses RLS, so it needs no policy of its own; what
    -- matters is that no permissive write policy exists for anon.
    execute format('revoke insert, update, delete, truncate on %I from anon, authenticated', t);
  end loop;
end $$;
