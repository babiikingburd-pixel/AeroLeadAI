-- Evidence Index (ported from evidence_index/ Python prototype) — output
-- columns for app/api/evidence-index/route.js. Idempotent, same style as
-- the rest of this repo's supabase_*_schema.sql files.
--
-- Deliberately separate from the existing evidence_score/confidence_score/
-- priority_score columns added by 20260801_add_twincities_priority.sql —
-- those back lib/twincities/priorityEngine.js's different formula shape
-- (Evidence Index v1.1, real per-county multipliers). This is a distinct
-- pipeline (ei_ prefix) with its own opportunity-based formula and neutral
-- county multipliers, run independently via /api/evidence-index.

alter table batch_leads add column if not exists ei_evidence_score integer default 0;
alter table batch_leads add column if not exists ei_confidence_score integer default 0;
alter table batch_leads add column if not exists ei_opportunity_raw bigint default 0;
alter table batch_leads add column if not exists ei_opportunity_normalized integer default 0;
alter table batch_leads add column if not exists ei_review_required boolean default false;
alter table batch_leads add column if not exists ei_review_reasons text[] default '{}';
alter table batch_leads add column if not exists ei_computed_at timestamptz;

create index if not exists idx_batch_leads_ei_review_required on batch_leads (ei_review_required);
