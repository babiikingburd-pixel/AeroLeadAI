-- AeroLeadAI Permit Directory
-- Run this once in your Supabase project's SQL Editor (Project > SQL Editor > New query).

create table if not exists permits (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  city text,
  county text,
  lat double precision,
  lng double precision,
  permit_type text,
  permit_number text,
  issue_date date,
  status text,
  roof_related boolean,
  source text default 'manual', -- 'manual' | 'opendata' | 'shovels' | 'permitstack' etc.
  source_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Fast address lookups (the console queries this on every lead)
create index if not exists idx_permits_address_normalized on permits (address_normalized);
create index if not exists idx_permits_roof_related on permits (roof_related);

-- Enable Row Level Security. The console uses the anon key, so open read/insert
-- to anon is what makes the browser-side lookup work. Tighten this later once
-- you're not the only one hitting it (e.g. require a service key for inserts).
alter table permits enable row level security;

create policy "Allow anon read" on permits
  for select using (true);

create policy "Allow anon insert" on permits
  for insert with check (true);

-- Optional: dedupe helper — call this instead of a raw insert if you want
-- "last write wins" per address instead of piling up duplicate rows.
-- (The console currently does a plain insert; upgrade to this if duplicates
-- become annoying.)
-- create unique index if not exists idx_permits_unique_address on permits (address_normalized);
