-- APEX 13.0 MAX cumulative intelligence layer
alter table if exists batch_leads
  add column if not exists digital_twin jsonb default '{}'::jsonb,
  add column if not exists evidence_graph jsonb default '{}'::jsonb,
  add column if not exists data_quality_state text default 'unknown',
  add column if not exists score_volatility numeric default 0,
  add column if not exists evidence_age_days numeric,
  add column if not exists next_recheck_at timestamptz;

create table if not exists property_findings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  category text not null,
  finding_type text not null,
  state text not null default 'unknown',
  confidence numeric,
  reliability numeric,
  observed_at timestamptz,
  source text,
  source_record jsonb default '{}'::jsonb,
  evidence_refs jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists property_relationships (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  left_type text not null,
  left_ref text,
  relation text not null,
  right_type text not null,
  right_ref text,
  confidence numeric,
  evidence_refs jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists property_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  snapshot_date date default current_date,
  state jsonb not null,
  score numeric,
  evidence_completeness numeric,
  evidence_confidence numeric,
  created_at timestamptz default now()
);

create table if not exists evidence_rechecks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  reason text not null,
  priority numeric default 0,
  due_at timestamptz,
  status text default 'queued',
  created_at timestamptz default now()
);

create index if not exists idx_property_findings_property
  on property_findings(property_id, category, created_at desc);

create index if not exists idx_property_relationships_property
  on property_relationships(property_id, created_at desc);

create index if not exists idx_property_rechecks_due
  on evidence_rechecks(status, due_at, priority desc);
