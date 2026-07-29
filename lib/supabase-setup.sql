create table if not exists leads (
  id text primary key default gen_random_uuid()::text,
  address text not null, city text, zip text,
  roof_score integer, drive_score integer, landscape_score integer,
  urgency text, est_value text, damage_notes text,
  home_age integer, sqft integer, image_url text,
  lat float, lng float, status text default 'new',
  created_at timestamptz default now()
);
create table if not exists scan_sessions (
  id text primary key default gen_random_uuid()::text,
  zip_code text, status text default 'running',
  leads_found integer default 0, started_at timestamptz default now()
);
alter table leads enable row level security;
create policy "Allow all" on leads for all using (true);
alter publication supabase_realtime add table leads;
