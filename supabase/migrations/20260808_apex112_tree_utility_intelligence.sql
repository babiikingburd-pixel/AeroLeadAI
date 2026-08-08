-- APEX 11.2-12.0 hazard evidence foundation
alter table if exists batch_leads
  add column if not exists tree_evidence jsonb default '{}'::jsonb,
  add column if not exists tree_hazard_score numeric,
  add column if not exists vegetation_maintenance_score numeric,
  add column if not exists utility_evidence jsonb default '{}'::jsonb,
  add column if not exists utility_hazard_score numeric,
  add column if not exists tree_utility_conflict_score numeric,
  add column if not exists historical_change_evidence jsonb default '{}'::jsonb,
  add column if not exists hazard_evidence jsonb default '{}'::jsonb,
  add column if not exists hazard_score numeric;

create index if not exists idx_batch_leads_hazard
  on batch_leads(hazard_score desc, tree_hazard_score desc, utility_hazard_score desc);

alter table if exists property_images
  add column if not exists evidence_category text,
  add column if not exists capture_date_confidence numeric,
  add column if not exists visual_match_confidence numeric;

alter table if exists image_evidence_jobs
  add column if not exists target_date date,
  add column if not exists target_category text;

create table if not exists property_historical_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  image_id uuid,
  target_year integer,
  capture_date date,
  source text,
  date_offset_years numeric,
  match_confidence numeric,
  quality_confidence numeric,
  status text default 'available',
  created_at timestamptz default now()
);

create index if not exists idx_property_historical_images
  on property_historical_images(property_id, target_year, capture_date);
