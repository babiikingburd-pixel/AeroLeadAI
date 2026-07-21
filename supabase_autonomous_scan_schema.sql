-- AeroLeadAI Autonomous Scanner — run once in your Supabase project's SQL
-- Editor (Project > SQL Editor > New query). Separate from
-- supabase_permits_schema.sql, which this doesn't touch.
--
-- Two tables:
--   zip_scan_queue — tracks which ZIPs have been scanned, are pending, or
--     failed, and which ZIP each one was discovered from (so you can see how
--     the scan expanded outward from your seed ZIP over time).
--   leads — every property the autonomous scanner has found and scored,
--     upserted by normalized address so re-scanning a ZIP updates existing
--     rows instead of duplicating them.

create table if not exists zip_scan_queue (
  zip text primary key,
  state text,
  status text not null default 'pending', -- 'pending' | 'scanning' | 'done' | 'failed'
  address_count int,
  leads_found int,
  last_error text,
  discovered_from text, -- which zip's neighbor-search found this one; null for the seed
  created_at timestamptz default now(),
  scanned_at timestamptz
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  zip text,
  lat double precision,
  lon double precision,
  damage_score int,
  damage_notes text,
  permit_within_10y boolean default false,
  permit_notes text,
  usps_verified boolean,
  tier text, -- hot | warm | cool | cold | low-priority | unscored
  source text default 'autonomous-scan',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_leads_address_normalized on leads (address_normalized);
create index if not exists idx_leads_zip on leads (zip);
create index if not exists idx_leads_tier on leads (tier);
create index if not exists idx_zip_scan_queue_status on zip_scan_queue (status);

-- RLS: read-only for anon (so a dashboard page can show progress with the
-- public anon key). No anon write policies on purpose — only the autonomous
-- scanner writes here, using SUPABASE_SERVICE_ROLE_KEY server-side, which
-- bypasses RLS entirely regardless of these policies.
alter table zip_scan_queue enable row level security;
alter table leads enable row level security;

create policy "Allow anon read" on zip_scan_queue for select using (true);
create policy "Allow anon read" on leads for select using (true);
