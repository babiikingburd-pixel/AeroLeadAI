-- APEX 10.2 Evidence Acceleration
-- Full permit history is retained; "within 10 years" is no longer the record itself.
-- Existing deployments can apply this migration safely.

alter table if exists property_images
  add column if not exists image_kind text default 'property_overview',
  add column if not exists quality_score numeric,
  add column if not exists evidence_status text default 'fetched',
  add column if not exists capture_date timestamptz,
  add column if not exists original_image_url text,
  add column if not exists enhanced_image_url text,
  add column if not exists crop_kind text;

alter table if exists batch_leads
  add column if not exists permit_history_count integer default 0,
  add column if not exists permit_history jsonb default '[]'::jsonb,
  add column if not exists weather_evidence_status text,
  add column if not exists weather_checked_at timestamptz,
  add column if not exists weather_evidence jsonb,
  add column if not exists weather_summary text,
  add column if not exists freeze_thaw_signal boolean,
  add column if not exists current_snow_signal boolean,
  add column if not exists evidence_cycle_at timestamptz,
  add column if not exists evidence_cycle_version text;

create index if not exists idx_batch_leads_apex102_rank
  on batch_leads(priority_score desc, confidence_score desc)
  where sales_status = 'new' and review_status <> 'rejected';

create index if not exists idx_property_images_kind
  on property_images(property_id, image_kind, fetched_at desc);
