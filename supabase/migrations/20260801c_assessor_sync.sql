-- Twin Cities Priority Engine — Part 3: assessor-data sync target. Run
-- AFTER 20260801_add_twincities_priority.sql and
-- 20260801b_evidence_audit_and_cache.sql. Idempotent, same style as the
-- rest of this repo's supabase_*_schema.sql files.
--
-- Backs app/api/sync-assessor-data/route.js — parcel_id is the resolve key
-- (point-based ArcGIS identify, not address matching; see
-- lib/twincities/normalizeAddress.js for why), replacement_cost is what
-- lib/twincities/priorityEngine.js reads as roofEstimateUsd.

alter table batch_leads add column if not exists parcel_id text;
alter table batch_leads add column if not exists replacement_cost bigint;

create index if not exists idx_batch_leads_parcel_id on batch_leads (parcel_id);

-- property_enrichment — isolated per-parcel record, separate from
-- batch_leads so a re-sync or a second lead at the same parcel doesn't
-- need to re-derive anything already computed for that parcel.
create table if not exists property_enrichment (
  id bigserial primary key,
  parcel_id text unique not null,
  estimated_roof_age integer,
  replacement_cost bigint,
  last_assessor_sync timestamptz default now()
);

create index if not exists idx_property_enrichment_parcel_id on property_enrichment (parcel_id);

alter table property_enrichment enable row level security;
do $$ begin
  create policy "Allow anon read" on property_enrichment for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on property_enrichment for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on property_enrichment for update using (true);
exception when duplicate_object then null; end $$;
