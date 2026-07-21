-- AeroLeadAI — Unified Schema (Layer 1 of the target architecture)
-- Run once in Supabase's SQL Editor. This is the server-side source of
-- truth every UI (deep-dive console, /batch, autonomous scanner) should
-- read/write through — localStorage becomes cache only, never truth.
--
-- Relationship to existing schema files:
--   supabase_permits_schema.sql   — unchanged structurally; this adds a
--                                    nullable property_id link (see below).
--   supabase_autonomous_scan_schema.sql — zip_scan_queue is UNCHANGED and
--                                    still the Layer-2 work queue. Its
--                                    `leads` table is SUPERSEDED by
--                                    `properties` below (source='autonomous-
--                                    scan') — this assumes `leads` has no
--                                    rows yet (autonomous scanning hasn't
--                                    gone live). If it already has real
--                                    data, say so before running the DROP
--                                    at the bottom — that part is written
--                                    to fail loudly rather than silently
--                                    discard rows.
--
-- Multi-tenancy: owner_id/territory columns exist now but are nullable and
-- RLS is permissive (matches today's single-tenant reality) — this avoids
-- an ALTER TABLE + backfill across every table when Layer 4 (auth +
-- territories) actually happens. Swapping to enforced RLS is a policy
-- change, not a schema change — the commented-out policies below show
-- exactly what that swap looks like.

-- ============================================================================
-- properties — the unified entity. Whether a human added it (deep-dive
-- console), it came from a paste-in batch run, or the autonomous scanner
-- found it, it's the same kind of record, distinguished by `source`.
-- ============================================================================
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id), -- null = unclaimed/single-tenant era
  territory text,

  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  lat double precision,
  lon double precision,
  zip text,

  parcel_id text,
  permit_id text,
  roof_type text,
  building_age int,
  roof_pitch text,

  source text not null default 'manual', -- 'manual' | 'batch' | 'autonomous-scan'
  stage text not null default 'queued',  -- 'queued' | 'processing' | 'scored' | 'promoted' | 'archived'

  findings_score int,      -- health score, higher = fewer concerns (100 - avg concern_score)
  tier text,                -- hot | warm | cool | cold | low-priority | unscored — denormalized for fast sort/filter
  permit_within_10y boolean not null default false,
  permit_notes text,
  usps_verified boolean,
  needs_human text[],       -- e.g. {geocode,imagery,scoring}
  suggested_actions text[],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_properties_address_normalized on properties (address_normalized);
create index if not exists idx_properties_zip on properties (zip);
create index if not exists idx_properties_tier on properties (tier);
create index if not exists idx_properties_owner on properties (owner_id);
create index if not exists idx_properties_source on properties (source);

-- ============================================================================
-- property_scores — per-domain agent findings (roof/tree/driveway/snow),
-- one row per run so history is kept instead of overwritten. Replaces the
-- old folders.aiFindings array.
-- ============================================================================
create table if not exists property_scores (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  domain text not null, -- roof | tree | driveway | snow
  concern_score int,
  confidence text,
  indicators text[],
  notes text,
  provider text, -- groq | anthropic
  runs int default 1,
  verification_agrees boolean,
  verification_note text,
  flagged_for_human boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_property_scores_property on property_scores (property_id);

-- ============================================================================
-- property_images — Storage-backed, not inline base64. Actual bytes belong
-- in the `property-images` Storage bucket (created below); this table is
-- just the pointer + metadata. Putting base64 in a text column here would
-- just move the localStorage quota problem into Postgres instead of fixing
-- it — bloated rows, real storage cost, slower queries.
-- ============================================================================
create table if not exists property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  kind text not null, -- roof | tree | driveway | overview_tight | overview_context | vantage1_facing_roofline | ...
  storage_path text not null, -- object key within the property-images bucket
  media_type text,
  source text, -- upload | auto-fetched (google) | auto-fetched (mapbox) | street-view sweep | auto-enhanced satellite
  enhanced boolean default false,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_property_images_property on property_images (property_id);

-- ============================================================================
-- property_notes — unifies what used to be four near-identical folders
-- (permits/manual, inspectionReports, contractorNotes, repairs) plus the
-- timeline log, distinguished by `kind`. Same shape, no reason for four
-- tables.
-- ============================================================================
create table if not exists property_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  kind text not null, -- permit | inspection_report | contractor_note | repair | timeline
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_property_notes_property on property_notes (property_id, kind);

-- ============================================================================
-- scans — server-side job log for pipeline runs (ZIP scan, batch address
-- list, single property, autonomous cron). Lets the browser submit a job and
-- poll status instead of running the whole pipeline in a page that dies if
-- the tab closes. Layer 2 work (actually queueing/processing these) is a
-- follow-up — this table is the shape it'll write to.
-- ============================================================================
create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  kind text not null, -- zip_scan | batch_addresses | single_property | autonomous
  status text not null default 'queued', -- queued | running | done | failed
  input jsonb,
  progress_done int not null default 0,
  progress_total int,
  result_summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_scans_status on scans (status);
create index if not exists idx_scans_owner on scans (owner_id);

-- ============================================================================
-- parcel_boundaries — stub for future county GIS / paid parcel-vendor
-- integration (Layer 4/5). Plain jsonb (GeoJSON) for now, no PostGIS
-- dependency — upgrade later if real geometry operations are needed.
-- ============================================================================
create table if not exists parcel_boundaries (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  source text not null,
  geometry jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_parcel_boundaries_property on parcel_boundaries (property_id);

-- ============================================================================
-- permits — link to properties (nullable: permit lookups can happen before
-- a property is ever scored). Structure otherwise unchanged from
-- supabase_permits_schema.sql.
-- ============================================================================
alter table if exists permits add column if not exists property_id uuid references properties(id);
create index if not exists idx_permits_property on permits (property_id);

-- ============================================================================
-- Storage bucket for property images (private — served via signed URLs, not
-- public listing).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('property-images', 'property-images', false)
on conflict (id) do nothing;

-- ============================================================================
-- RLS — permissive for now (matches today's single-tenant reality: the
-- browser uses the anon key directly). Enable + policies below. The
-- commented block under each shows the Layer-4 swap (owner-scoped) — same
-- tables, no schema change needed when that day comes.
-- ============================================================================
alter table properties enable row level security;
alter table property_scores enable row level security;
alter table property_images enable row level security;
alter table property_notes enable row level security;
alter table scans enable row level security;
alter table parcel_boundaries enable row level security;

create policy "anon read" on properties for select using (true);
create policy "anon write" on properties for all using (true) with check (true);
create policy "anon read" on property_scores for select using (true);
create policy "anon write" on property_scores for all using (true) with check (true);
create policy "anon read" on property_images for select using (true);
create policy "anon write" on property_images for all using (true) with check (true);
create policy "anon read" on property_notes for select using (true);
create policy "anon write" on property_notes for all using (true) with check (true);
create policy "anon read" on scans for select using (true);
create policy "anon write" on scans for all using (true) with check (true);
create policy "anon read" on parcel_boundaries for select using (true);
create policy "anon write" on parcel_boundaries for all using (true) with check (true);

-- Layer 4 swap (run this when auth + territories go live — replaces the
-- permissive policies above with owner-scoped ones):
--
-- drop policy "anon read" on properties; drop policy "anon write" on properties;
-- create policy "owner read" on properties for select using (owner_id = auth.uid());
-- create policy "owner write" on properties for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- (repeat per table, joining through property_id for the child tables)

create policy "anon read own uploads" on storage.objects for select using (bucket_id = 'property-images');
create policy "anon write own uploads" on storage.objects for insert with check (bucket_id = 'property-images');

-- ============================================================================
-- Supersedes supabase_autonomous_scan_schema.sql's `leads` table. Only run
-- this if you're certain `leads` has no rows you care about (autonomous
-- scanning was just built and hasn't gone live yet, so this should be true
-- — but this DROP is written to fail loudly instead of silently discarding
-- data if it's not).
-- ============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'leads') then
    if exists (select 1 from public.leads limit 1) then
      raise exception 'leads table has existing rows — migrate them into properties (source=''autonomous-scan'') before dropping. This statement stopped on purpose.';
    else
      drop table public.leads;
    end if;
  end if;
end $$;
