-- AeroLeadAI Phase 2 + AI Executive Engine
-- Run in your Supabase project's SQL Editor, after supabase_ops_schema.sql
-- (this file references the contractors/jobs tables it creates). Safe to
-- re-run (idempotent).
--
-- Adapted from a reference schema.sql/schema_v2.sql that assumed its own
-- separate leads/contractors/jobs tables (built for a different, Bland.ai +
-- Stripe-dependent workflow this project isn't using) — rewritten here to
-- extend the batch_leads/contractors/jobs tables already live in this app,
-- so Phase 2 features and everything already shipped share one data model.

-- ============================================================
-- #10 Contractor Growth Engine
-- ============================================================
create table if not exists contractor_candidates (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  phone text, email text,
  license_number text, license_state text,
  insurance_doc_url text,
  service_types text[] default '{}',
  status text default 'pending_verification', -- pending_verification | verified | rejected | onboarded
  license_verified boolean,
  insurance_verified boolean,
  verification_notes text,
  contractor_id uuid references contractors(id),
  verified_at timestamptz,
  created_at timestamptz default now()
);
alter table contractors add column if not exists license_number text;
alter table contractors add column if not exists license_state text;
alter table contractors add column if not exists insurance_expires_at timestamptz;
alter table contractors add column if not exists suspension_reason text;
-- Separate from zip_coverage (geography) -- this is damage-type specialty
-- (roof/tree/driveway, matching the domains this app actually scores).
alter table contractors add column if not exists service_types text[] default '{}';

-- ============================================================
-- #11 AI Sales & Marketing Engine
-- ============================================================
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null, -- sms | email | google_ads | meta_ads | direct_mail
  target_zip_codes text[],
  budget_cents integer,
  storm_triggered boolean default false,
  status text default 'active', -- active | paused | completed
  created_at timestamptz default now()
);
alter table batch_leads add column if not exists campaign_id uuid references campaigns(id);
alter table batch_leads add column if not exists opted_out boolean default false;
alter table batch_leads add column if not exists nurture_log jsonb default '[]';

-- ============================================================
-- #12 Trust & Quality Platform
-- ============================================================
create table if not exists job_audits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  consistent boolean,
  confidence numeric,
  issues jsonb,
  recommendation text,
  satisfaction_score int,
  satisfaction_comment text,
  audited_at timestamptz default now()
);
alter table jobs add column if not exists quality_flag boolean default false;
alter table jobs add column if not exists quality_flag_reason text;
-- Snapshot of AI-annotated damage findings (from /api/damage-annotate) at job
-- creation time, so a later quality audit has a real "before" to compare the
-- contractor's after-photo against instead of just a single score.
alter table jobs add column if not exists damage_summary jsonb;

-- ============================================================
-- #13 Unified Property Record (address-keyed, not FK-locked to any one
-- source table, since properties arrive via Console, Batch, Discovery, and
-- Scanner independently)
-- ============================================================
create table if not exists property_records (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  lat double precision, lon double precision,
  organization_id uuid,
  history jsonb default '[]', -- append-only: [{at, event, source, data}]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists idx_property_records_address on property_records(address_normalized);
alter table batch_leads add column if not exists property_id uuid references property_records(id);

-- ============================================================
-- #14 Enterprise & Government Services
-- ============================================================
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text, -- municipality | property_manager | hoa | insurer | commercial_portfolio
  billing_contact text,
  created_at timestamptz default now()
);
create table if not exists organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  email text not null,
  role text not null -- org_admin | org_manager | org_viewer
);
do $$ begin
  alter table property_records add constraint fk_property_org foreign key (organization_id) references organizations(id);
exception when duplicate_object then null; end $$;

-- ============================================================
-- #15 Financial Services (Stripe-dependent — tables exist so the UI/logic
-- has somewhere to write once you actually configure Stripe; empty and
-- inert without it, not simulated)
-- ============================================================
create table if not exists escrow_holds (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  payment_intent_id text,
  amount_cents integer,
  status text default 'held', -- held | released | refunded
  transfer_id text,
  refund_reason text,
  released_at timestamptz,
  created_at timestamptz default now()
);
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid references contractors(id),
  stripe_subscription_id text,
  status text,
  created_at timestamptz default now()
);

-- ============================================================
-- #16 Developer & Integration Platform
-- ============================================================
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  label text,
  key_hash text not null,
  scopes text[] default '{}',
  active boolean default true,
  created_at timestamptz default now()
);
create table if not exists webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  url text not null,
  events text[] default '{}',
  active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- #18 National Expansion Playbook
-- ============================================================
create table if not exists region_launches (
  id uuid primary key default gen_random_uuid(),
  region_name text not null,
  states text[],
  target_zip_codes text[],
  checklist jsonb default '[]',
  status text default 'in_progress',
  created_at timestamptz default now()
);

-- ============================================================
-- AI Executive Engine — decision persistence. The engine's own
-- DecisionRegistry/reportGenerator default to in-memory Map + local
-- filesystem, both of which are wrong for Vercel serverless (no shared
-- memory or persistent disk across requests) — this is the DB-backed swap
-- the engine's own docs say to make.
-- ============================================================
create table if not exists decisions (
  id text primary key, -- caller-provided decision id, e.g. "pricing-q3-2026"
  question text not null,
  proposed_action text,
  depends_on text references decisions(id),
  status text default 'pending', -- pending|negotiating|approved|escalated|blocked_by_dependency|resolved_by_human
  result jsonb,
  second_opinion jsonb,
  human_resolution jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists decision_reports (
  id uuid primary key default gen_random_uuid(),
  decision_id text references decisions(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_property_records_org on property_records(organization_id);
create index if not exists idx_job_audits_job on job_audits(job_id);
create index if not exists idx_api_keys_hash on api_keys(key_hash);
create index if not exists idx_campaigns_status on campaigns(status);
create index if not exists idx_decisions_status on decisions(status);
create index if not exists idx_decision_reports_decision on decision_reports(decision_id);

-- RLS — same open anon-key pattern as every other table in this app (no
-- per-user auth gate on these consoles yet). decision_reports gets NO
-- update/delete policy at all — that's what makes it tamper-evident
-- (Supabase equivalent of the engine's own chmod-read-only intent).
alter table contractor_candidates enable row level security;
alter table campaigns enable row level security;
alter table job_audits enable row level security;
alter table property_records enable row level security;
alter table organizations enable row level security;
alter table organization_users enable row level security;
alter table escrow_holds enable row level security;
alter table subscriptions enable row level security;
alter table api_keys enable row level security;
alter table webhook_subscriptions enable row level security;
alter table region_launches enable row level security;
alter table decisions enable row level security;
alter table decision_reports enable row level security;

do $$ begin
  create policy "Allow anon all" on contractor_candidates for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on campaigns for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on job_audits for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on property_records for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on organizations for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on organization_users for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on escrow_holds for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on subscriptions for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on api_keys for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on webhook_subscriptions for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon all" on region_launches for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon read" on decisions for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on decisions for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on decisions for update using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon read" on decision_reports for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on decision_reports for insert with check (true);
exception when duplicate_object then null; end $$;
-- Deliberately no update/delete policy on decision_reports — once written,
-- a report can't be edited or removed through the anon key. That's the point.
