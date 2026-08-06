-- APEX 10.1 — configurable governance thresholds + paid-call cost ledger.
--
-- twincities_apex_controls has existed since the 10.0 migration and was read
-- by nothing: apex10_rebuild_leaderboard() hardcoded confidence >= 70 and
-- evidence quality >= 65 for top500, and 55/55 for candidate, while the
-- controls row said 55/55 and did nothing at all. This makes the table the
-- actual source of those thresholds.
--
-- The seeded row is set to 70/65 rather than left at its old 55/55 default so
-- that wiring it up does NOT silently change who gets promoted. The candidate
-- thresholds get their own columns instead of sharing the promotion ones.

alter table twincities_apex_controls
  add column if not exists min_confidence_for_candidate numeric not null default 55;
alter table twincities_apex_controls
  add column if not exists min_evidence_quality_for_candidate numeric not null default 55;
alter table twincities_apex_controls
  add column if not exists stability_cycles integer not null default 2;
alter table twincities_apex_controls
  add column if not exists top_n integer not null default 500;

-- Paid-lookup kill switch. Tripped automatically by lib/twincities/costGuard.js
-- when a daily cap is crossed; cleared only by a human, because a runaway that
-- resets itself is still a runaway.
alter table twincities_apex_controls
  add column if not exists paid_lookups_enabled boolean not null default true;
alter table twincities_apex_controls
  add column if not exists paid_lookups_disabled_at timestamptz;
alter table twincities_apex_controls
  add column if not exists paid_lookups_disabled_reason text;
alter table twincities_apex_controls
  add column if not exists permit_daily_call_cap integer not null default 500;
alter table twincities_apex_controls
  add column if not exists imagery_daily_call_cap integer not null default 2000;

insert into twincities_apex_controls (id) values (1) on conflict (id) do nothing;

-- Preserve the thresholds the 10.0 function actually enforced.
update twincities_apex_controls
   set min_confidence_for_promotion = 70,
       min_evidence_quality_for_promotion = 65,
       updated_at = now()
 where id = 1
   and min_confidence_for_promotion = 55
   and min_evidence_quality_for_promotion = 55;

-- Per-call ledger for everything billable. costGuard.reserve() counts rows
-- here against the caps above and fails closed if it cannot read them, so this
-- table is load-bearing, not just reporting.
create table if not exists worker_cost_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  worker_id text,
  lead_id text,
  units integer not null default 1,
  billable boolean not null default true,
  ok boolean not null default true,
  estimated_cost_usd numeric not null default 0,
  detail text,
  created_at timestamptz not null default now()
);

-- The index reserve() lives on: one count per paid call, so it has to be cheap.
create index if not exists idx_worker_cost_events_provider_day
  on worker_cost_events (provider, created_at desc) where billable;
create index if not exists idx_worker_cost_events_lead
  on worker_cost_events (lead_id, created_at desc);

alter table worker_cost_events enable row level security;
drop policy if exists worker_cost_events_read on worker_cost_events;
create policy worker_cost_events_read on worker_cost_events for select using (true);
revoke insert, update, delete, truncate on worker_cost_events from anon, authenticated;
