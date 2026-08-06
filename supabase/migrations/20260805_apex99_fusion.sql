-- APEX 9.9 Evidence Fusion + Challenger Promotion
alter table batch_leads add column if not exists evidence_quality_score numeric default 0;
alter table batch_leads add column if not exists evidence_fusion_score numeric default 0;
alter table batch_leads add column if not exists evidence_fusion_confidence numeric default 0;
alter table batch_leads add column if not exists challenger_score numeric default 0;
alter table batch_leads add column if not exists leaderboard_status text default 'unranked';
alter table batch_leads add column if not exists last_fused_at timestamptz;
alter table batch_leads add column if not exists evidence_fusion_version text;

create table if not exists twincities_leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_version text not null,
  rank integer not null,
  lead_id text not null,
  priority_score numeric,
  evidence_fusion_score numeric,
  evidence_confidence numeric,
  leaderboard_status text,
  reasons jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_tc_lb_snapshot_time on twincities_leaderboard_snapshots(created_at desc);
create index if not exists idx_tc_lb_snapshot_lead on twincities_leaderboard_snapshots(lead_id, created_at desc);

create table if not exists twincities_challengers (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  source_rank integer,
  challenger_score numeric,
  reason jsonb default '{}'::jsonb,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_tc_challengers_status_score on twincities_challengers(status, challenger_score desc);

create table if not exists twincities_fusion_events (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  prior_score numeric,
  fused_score numeric,
  confidence numeric,
  evidence_quality numeric,
  decision text,
  reasons jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_tc_fusion_events_lead_time on twincities_fusion_events(lead_id, created_at desc);
