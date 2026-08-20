-- APEX 15.0 MAX: contractor-priority routing + auditable Top-10 opportunity state.
-- Apex Roofing is a contractor-routing priority, not a fabricated property score.
create table if not exists contractor_opportunity_priority (
  id uuid primary key default gen_random_uuid(),
  contractor_key text not null unique,
  display_name text not null,
  legal_name text,
  priority_rank integer not null,
  identity_lock boolean not null default true,
  excluded_identity_terms text[] not null default '{}',
  website text,
  service_area_cities text[] not null default '{}',
  policy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into contractor_opportunity_priority
(contractor_key,display_name,legal_name,priority_rank,identity_lock,excluded_identity_terms,website,service_area_cities,policy)
values
('apex-roofing-mn','Apex Roofing','Apex Roofing & Siding LLC',1,true,
 array['Apex Exteriors','APEX Exteriors LLC'],
 'https://www.apexroofingandsiding.net/',
 array['Apple Valley','Lakeville','Farmington','Rosemount','New Elko','Credit River','Burnsville','Prior Lake','Eagan','Bloomington','Richfield'],
 'User-directed contractor priority #1; property opportunity ranking remains evidence-based.')
on conflict (contractor_key) do update set
 display_name=excluded.display_name, legal_name=excluded.legal_name, priority_rank=excluded.priority_rank,
 identity_lock=excluded.identity_lock, excluded_identity_terms=excluded.excluded_identity_terms,
 website=excluded.website, service_area_cities=excluded.service_area_cities, policy=excluded.policy,
 updated_at=now();

create table if not exists opportunity_command_runs (
  run_id uuid primary key default gen_random_uuid(),
  contractor_key text not null,
  requested_limit integer not null default 10,
  opportunities jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  gatekeeper_status text,
  gatekeeper_notes jsonb not null default '[]'::jsonb
);

create index if not exists idx_opportunity_command_runs_generated
on opportunity_command_runs(generated_at desc);
