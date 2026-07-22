-- AeroLeadAI Batch Lead Queue
-- Run once in your Supabase project's SQL Editor (Project > SQL Editor > New query).
--
-- Backs the /batch (Mass Upload) console's ZIP-code-search queue so leads
-- persist across devices/sessions/browsers instead of living only in
-- localStorage. Image files are NOT stored here — they stay client-side and
-- are re-fetched free from /api/imagery-agent on demand. This table stores
-- the lightweight lead record: address, coordinates, damage scores, permit
-- status, pipeline stage.

create table if not exists batch_leads (
  id text primary key, -- client-generated id, matches the in-app item id
  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  lat double precision,
  lon double precision,
  stage text default 'queued', -- 'queued' | 'processing' | 'done'
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

create index if not exists idx_batch_leads_address_normalized on batch_leads (address_normalized);
create index if not exists idx_batch_leads_stage on batch_leads (stage);

alter table batch_leads enable row level security;

-- The batch console has no per-user auth gate today (unlike the main
-- deep-dive console's magic-link mode), so this mirrors the permits table:
-- open to the anon key for now. Tighten once the batch console gets its own
-- auth.
create policy "Allow anon read" on batch_leads for select using (true);
create policy "Allow anon insert" on batch_leads for insert with check (true);
create policy "Allow anon update" on batch_leads for update using (true);
create policy "Allow anon delete" on batch_leads for delete using (true);
