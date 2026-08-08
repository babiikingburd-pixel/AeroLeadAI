-- APEX 10.3 COMPLETE EVIDENCE
alter table if exists property_images
  add column if not exists crop_kind text,
  add column if not exists crop_bbox jsonb,
  add column if not exists enhancement_status text default 'not_processed',
  add column if not exists visual_analysis jsonb,
  add column if not exists source_capture_date text,
  add column if not exists property_match_confidence numeric,
  add column if not exists image_quality_reason text;

alter table if exists batch_leads
  add column if not exists evidence_completeness numeric default 0,
  add column if not exists evidence_confidence numeric default 0,
  add column if not exists maintenance_score numeric,
  add column if not exists driveway_score numeric,
  add column if not exists roof_visual_score numeric,
  add column if not exists exterior_visual_score numeric,
  add column if not exists grounds_visual_score numeric,
  add column if not exists visual_evidence jsonb default '{}'::jsonb,
  add column if not exists storm_evidence jsonb default '{}'::jsonb,
  add column if not exists permit_evidence jsonb default '{}'::jsonb,
  add column if not exists property_value_evidence jsonb default '{}'::jsonb,
  add column if not exists evidence_last_updated timestamptz,
  add column if not exists evidence_next_check timestamptz,
  add column if not exists evidence_pipeline_version text;

create index if not exists idx_property_images_evidence
  on property_images(property_id, image_kind, enhancement_status, fetched_at desc);

create index if not exists idx_batch_leads_evidence_rank
  on batch_leads(priority_score desc, evidence_completeness desc, evidence_confidence desc);

create table if not exists image_evidence_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  source_image_id uuid,
  target_kind text not null,
  status text not null default 'queued',
  output_image_id uuid,
  requested_at timestamptz default now(),
  completed_at timestamptz,
  pipeline_version text,
  error text,
  unique(property_id, target_kind)
);
create index if not exists idx_image_evidence_jobs_queue
  on image_evidence_jobs(status, requested_at);
