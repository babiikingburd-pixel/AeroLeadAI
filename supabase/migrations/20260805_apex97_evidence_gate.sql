-- APEX 9.7 Evidence Gate / Autonomous Validation
-- Idempotent migration. Run once in Supabase SQL Editor.

alter table batch_leads add column if not exists permit_evidence_status text;
alter table batch_leads add column if not exists permit_checked_at timestamptz;
alter table batch_leads add column if not exists value_evidence_status text;
alter table batch_leads add column if not exists value_checked_at timestamptz;
alter table batch_leads add column if not exists value_source text;
alter table batch_leads add column if not exists assessor_checked_at timestamptz;
alter table batch_leads add column if not exists image_evidence_status text;
alter table batch_leads add column if not exists image_fetched_at timestamptz;
alter table batch_leads add column if not exists image_review_status text default 'unreviewed';
alter table batch_leads add column if not exists image_review_confidence numeric;
alter table batch_leads add column if not exists storm_evidence_status text;
alter table batch_leads add column if not exists storm_checked_at timestamptz;
alter table batch_leads add column if not exists validation_worker_id text;
alter table batch_leads add column if not exists validation_evidence_version text;

create table if not exists twincities_validation_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  priority numeric not null default 0,
  requested_checks jsonb not null default '[]'::jsonb,
  reason text,
  status text not null default 'queued',
  attempts integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tc_validation_jobs_queue
  on twincities_validation_jobs (status, priority desc, next_attempt_at);
create index if not exists idx_tc_validation_jobs_property
  on twincities_validation_jobs (property_id, status);

create table if not exists score_history (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  score_before numeric,
  score_after numeric,
  changed_by text,
  reason jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_score_history_lead_time
  on score_history (lead_id, created_at desc);

create table if not exists evidence_events (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  claim_type text not null,
  claim_value jsonb,
  source_type text,
  source_locator text,
  confidence numeric,
  crawler_id text,
  content_hash text,
  previous_event_hash text,
  event_hash text,
  created_at timestamptz not null default now()
);
create index if not exists idx_evidence_events_lead_time
  on evidence_events (lead_id, created_at desc);
create index if not exists idx_evidence_events_hash
  on evidence_events (event_hash);

-- Evidence-gate indexes: make the global leaderboard and validation queue cheap.
create index if not exists idx_batch_leads_tc_global_score
  on batch_leads (county, sales_status, priority_score desc, confidence_score desc);
create index if not exists idx_batch_leads_validation_due
  on batch_leads (county, sales_status, next_validation_at);

comment on column batch_leads.image_evidence_status is
  'Retrieval state only: fetched/failed. Never means damage was visually verified.';
comment on column batch_leads.image_review_status is
  'Actual image assessment state. verified requires a real AI or human review result.';
