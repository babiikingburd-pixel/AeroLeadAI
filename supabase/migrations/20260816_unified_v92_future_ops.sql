-- AeroLeadAI Unified v9.2: decision/outcome telemetry
create table if not exists public.aerolead_decision_events (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  event_type text not null,
  actor_type text not null default 'system',
  decision text,
  reason text,
  evidence_refs jsonb not null default '[]'::jsonb,
  confidence numeric,
  estimated_cost numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists aerolead_decision_events_property_idx
  on public.aerolead_decision_events(property_id, created_at desc);

create table if not exists public.aerolead_field_outcomes (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  predicted_score numeric,
  outcome text not null,
  confirmed boolean,
  human_agreed boolean,
  revenue numeric,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists aerolead_field_outcomes_property_idx
  on public.aerolead_field_outcomes(property_id, created_at desc);

-- Applied 2026-08-16 via Supabase MCP: lock telemetry tables to service-role
-- writes only (matches existing apex_* convention; linter flagged these as
-- rls_disabled_in_public ERROR without this).
alter table public.aerolead_decision_events enable row level security;
alter table public.aerolead_field_outcomes  enable row level security;
