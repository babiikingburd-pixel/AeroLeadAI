-- APEX 11.0 cumulative operational layer
alter table if exists batch_leads
  add column if not exists evidence_pipeline_status text default 'queued',
  add column if not exists evidence_last_error text,
  add column if not exists evidence_attempts integer default 0,
  add column if not exists evidence_retry_at timestamptz,
  add column if not exists evidence_score_breakdown jsonb default '{}'::jsonb,
  add column if not exists evidence_snapshot jsonb default '{}'::jsonb,
  add column if not exists top500_rank integer,
  add column if not exists top500_rank_checked_at timestamptz;

create table if not exists evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  pipeline_version text not null,
  snapshot jsonb not null,
  score numeric,
  rank integer,
  created_at timestamptz default now()
);

create table if not exists evidence_queue (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  job_type text not null,
  priority numeric default 0,
  status text default 'queued',
  attempts integer default 0,
  available_at timestamptz default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  pipeline_version text,
  created_at timestamptz default now(),
  unique(property_id, job_type)
);

create index if not exists idx_evidence_queue_ready
  on evidence_queue(status, priority desc, available_at);

create index if not exists idx_evidence_snapshots_property
  on evidence_snapshots(property_id, created_at desc);
