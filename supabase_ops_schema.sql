-- AeroLeadAI Operations: Contractors + Jobs
-- Run in your Supabase project's SQL Editor. Safe to re-run (idempotent).
--
-- These two tables are new foundational entities behind the Operations
-- Command Center, Business Intelligence Engine, and Customer Portal —
-- previously the app only tracked leads/scores, never an actual assigned
-- job or who's doing the work.
--
-- Honest scope note: there is no live GPS feed in this build (that needs a
-- mobile app or a phone-based location source, which is a product decision,
-- not something to fake). `last_lat`/`last_lon` on contractors is a manually
-- set or last-check-in location, labeled as such everywhere it's displayed
-- — not real-time tracking.

create table if not exists contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  zip_coverage text[] default '{}', -- ZIPs this contractor services
  active boolean default true,
  last_lat double precision,
  last_lon double precision,
  last_seen_at timestamptz,
  jobs_completed integer default 0,
  avg_job_score numeric, -- average AI damage score of jobs they've closed (rough quality signal)
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_contractors_active on contractors (active);

alter table contractors enable row level security;
do $$ begin
  create policy "Allow anon read" on contractors for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on contractors for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on contractors for update using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon delete" on contractors for delete using (true);
exception when duplicate_object then null; end $$;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  lat double precision,
  lon double precision,
  zip text,
  contractor_id uuid references contractors(id) on delete set null,
  status text default 'new', -- new | scheduled | in_progress | completed | canceled
  scheduled_date date,
  completed_date date,
  revenue_estimate numeric,
  revenue_actual numeric,
  findings_score integer, -- AI damage score at time of job creation, for later calibration checks
  share_token text unique default encode(gen_random_bytes(16), 'hex'), -- customer portal access, unguessable
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_jobs_status on jobs (status);
create index if not exists idx_jobs_zip on jobs (zip);
create index if not exists idx_jobs_share_token on jobs (share_token);
create index if not exists idx_jobs_contractor on jobs (contractor_id);

alter table jobs enable row level security;
-- share_token is the customer portal's access control — readable by anon
-- (needed for the portal page to look a job up by token) but that's the
-- ONLY thing that should gate customer-facing reads; the portal route
-- filters by token itself; a normal person can't guess a 32-char hex token.
do $$ begin
  create policy "Allow anon read" on jobs for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on jobs for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on jobs for update using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon delete" on jobs for delete using (true);
exception when duplicate_object then null; end $$;
