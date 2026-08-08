-- APEX 10.0 Autonomous Leaderboard + Governance
alter table batch_leads add column if not exists apex_rank integer;
alter table batch_leads add column if not exists apex_tier text default 'unranked';
alter table batch_leads add column if not exists apex_decision text;
alter table batch_leads add column if not exists apex_decision_reason jsonb default '{}'::jsonb;
alter table batch_leads add column if not exists apex_decided_at timestamptz;
alter table batch_leads add column if not exists apex_governance_version text;

create table if not exists twincities_apex_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_id text unique not null,
  version text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  scanned integer default 0,
  fused integer default 0,
  promoted integer default 0,
  demoted integer default 0,
  held integer default 0,
  notes jsonb default '{}'::jsonb
);
create table if not exists twincities_apex_decisions (
  id uuid primary key default gen_random_uuid(),
  cycle_id text not null,
  lead_id text not null,
  old_rank integer,
  new_rank integer,
  old_tier text,
  new_tier text,
  decision text not null,
  confidence numeric,
  evidence_quality numeric,
  reason jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_tc_apex_decisions_cycle on twincities_apex_decisions(cycle_id);
create index if not exists idx_tc_apex_decisions_lead on twincities_apex_decisions(lead_id, created_at desc);

create table if not exists twincities_apex_controls (
  id integer primary key default 1,
  enabled boolean not null default true,
  max_daily_promotions integer not null default 1000,
  min_confidence_for_promotion numeric not null default 55,
  min_evidence_quality_for_promotion numeric not null default 55,
  updated_at timestamptz not null default now()
);
insert into twincities_apex_controls(id) values (1) on conflict (id) do nothing;
