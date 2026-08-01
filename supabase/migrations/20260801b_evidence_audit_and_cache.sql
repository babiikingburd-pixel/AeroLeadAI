-- Twin Cities Priority Engine — Part 2: audit trail, review state machine,
-- parcel caching, contractor export tracking. Run AFTER
-- 20260801_add_twincities_priority.sql. Idempotent, same style as the
-- rest of this repo's supabase_*_schema.sql files.

-- ============================================================
-- 1. Evidence audit trail — machine-readable "why did this score a 94"
-- ============================================================
alter table batch_leads add column if not exists evidence_breakdown jsonb default '{}'::jsonb;
-- shape written by lib/twincities/evidenceAudit.js:
-- { maturity, hail, wind, snow, tree_overhang, driveway, gutter, county_multiplier, final }

-- ============================================================
-- 2. Human-review state machine — replaces the plain boolean with a real
-- pipeline status. human_review / human_review_status (added in part 1)
-- stay as-is for backward compat with the top-leads route already built;
-- review_status is the authoritative state machine going forward.
-- ============================================================
alter table batch_leads add column if not exists review_status text default 'pending';
-- values: pending | approved | rejected | needs_images | contractor_sent | closed_won | closed_lost
alter table batch_leads add column if not exists review_status_updated_at timestamptz default now();

-- confidence_score already exists from part 1 (INTEGER DEFAULT 0) — no
-- duplicate column here. Part 1 never actually computed it; that's fixed
-- in lib/twincities/priorityEngine.js in this same pass, not just the schema.

create index if not exists idx_batch_leads_review_status on batch_leads (review_status);

-- ============================================================
-- 3. Parcel cache — county GIS calls are expensive across six government
-- servers; this decouples "have we ever looked this address up" from
-- batch_leads itself so re-scans, re-imports, or duplicate addresses from
-- different pipelines all share one cached lookup.
-- ============================================================
create table if not exists parcel_cache (
  id bigserial primary key,
  address_normalized text unique not null,
  county text,
  assessed_value bigint,
  year_built integer,
  value_source text,
  updated_at timestamptz default now()
);

create index if not exists idx_parcel_cache_county on parcel_cache (county);

alter table parcel_cache enable row level security;
do $$ begin
  create policy "Allow anon read" on parcel_cache for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on parcel_cache for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on parcel_cache for update using (true);
exception when duplicate_object then null; end $$;

-- ============================================================
-- 4. Contractor export tracking — who got which leads, when, so
-- close-rate can eventually be measured per contractor/territory.
-- ============================================================
create table if not exists contractor_exports (
  id bigserial primary key,
  contractor_name text not null,
  zip_code text,
  county text,
  lead_ids text[] default '{}', -- batch_leads.id values included in this export
  exported_count integer default 0,
  tier text, -- 'candidates_500' | 'review_100' | 'contractor_20'
  exported_at timestamptz default now()
);

create index if not exists idx_contractor_exports_contractor on contractor_exports (contractor_name);

alter table contractor_exports enable row level security;
do $$ begin
  create policy "Allow anon read" on contractor_exports for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on contractor_exports for insert with check (true);
exception when duplicate_object then null; end $$;
