-- AeroLeadAI Batch Lead Queue + Imagery Cache/History
-- Run in your Supabase project's SQL Editor (Project > SQL Editor > New
-- query). Safe to re-run — every statement is idempotent, so this works
-- whether you're setting up fresh or already ran an earlier version of this
-- file (the batch_leads table used to be the whole file; lead-management
-- and imagery-history columns/tables were added later).

-- ============================================================
-- batch_leads: backs the /batch (Mass Upload) console's queue so leads
-- persist across devices/sessions/browsers instead of living only in
-- localStorage. Image files are NOT stored here — they stay client-side
-- (imagery_cache below handles server-side imagery reuse separately). This
-- table stores the lead record: address, coordinates, damage scores, permit
-- status, pipeline stage, and (as of this version) sales status/notes/tags/
-- search fields for lead management.
-- ============================================================

create table if not exists batch_leads (
  id text primary key, -- client-generated id, matches the in-app item id
  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  lat double precision,
  lon double precision,
  stage text default 'queued', -- pipeline stage: 'queued' | 'processing' | 'done'
  roof_score integer,
  tree_score integer,
  driveway_score integer,
  damage_notes jsonb,
  permit_within_10y boolean default false,
  permit_notes text,
  source text default 'batch-console',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lead management columns (status pipeline, notes/tags, search fields).
alter table batch_leads add column if not exists sales_status text default 'new'; -- 'new' | 'contacted' | 'estimate_scheduled' | 'won' | 'lost'
alter table batch_leads add column if not exists owner text;
alter table batch_leads add column if not exists notes text;
alter table batch_leads add column if not exists tags text[] default '{}';
alter table batch_leads add column if not exists city text;
alter table batch_leads add column if not exists state text;
alter table batch_leads add column if not exists zip text;

create index if not exists idx_batch_leads_address_normalized on batch_leads (address_normalized);
create index if not exists idx_batch_leads_stage on batch_leads (stage);
create index if not exists idx_batch_leads_sales_status on batch_leads (sales_status);
create index if not exists idx_batch_leads_zip on batch_leads (zip);

alter table batch_leads enable row level security;

-- The batch console has no per-user auth gate today (unlike the main
-- deep-dive console's magic-link mode), so this mirrors the permits table:
-- open to the anon key for now. Tighten once the batch console gets its own
-- auth. Wrapped in DO blocks so re-running this file doesn't error on
-- "policy already exists".
do $$ begin
  create policy "Allow anon read" on batch_leads for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on batch_leads for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on batch_leads for update using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon delete" on batch_leads for delete using (true);
exception when duplicate_object then null; end $$;

-- ============================================================
-- imagery_cache: one row per rounded lat/lon, holding the most recent
-- fetch. /api/imagery-agent checks this before hitting Google/Mapbox/Esri,
-- so repeat requests for the same property (re-running the batch pipeline,
-- reloading the deep-dive console) don't re-hit the imagery APIs. Refetched
-- automatically after 30 days (see CACHE_TTL_MS in the route) since
-- satellite/street imagery doesn't change often.
-- ============================================================

create table if not exists imagery_cache (
  key text primary key, -- "lat.fixed5,lon.fixed5"
  lat double precision,
  lon double precision,
  provider text,
  angles jsonb,     -- { overview_tight: dataUrl, overview_context: dataUrl, ... }
  resolution jsonb,  -- per-angle { source, zoom, metersPerPixel }
  fetched_at timestamptz default now()
);

alter table imagery_cache enable row level security;
do $$ begin
  create policy "Allow anon read" on imagery_cache for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on imagery_cache for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on imagery_cache for update using (true);
exception when duplicate_object then null; end $$;

-- ============================================================
-- imagery_history: append-only log of every genuinely fresh imagery fetch
-- (cache hits do NOT create a new row). This is what powers before/after
-- comparison in the console — each re-scan of a property that falls outside
-- the cache TTL (or is force-refreshed) adds another dated snapshot you can
-- compare against earlier ones.
-- ============================================================

create table if not exists imagery_history (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  lat double precision,
  lon double precision,
  provider text,
  angles jsonb,
  resolution jsonb,
  fetched_at timestamptz default now()
);

create index if not exists idx_imagery_history_key on imagery_history (key);

alter table imagery_history enable row level security;
do $$ begin
  create policy "Allow anon read" on imagery_history for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on imagery_history for insert with check (true);
exception when duplicate_object then null; end $$;
