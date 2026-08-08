-- AeroLeadAI Property Intelligence Schema (v2)
-- Run in Supabase SQL Editor. Additive — does not touch the existing
-- `permits` table, it just gives it (and everything else) somewhere to attach to.
--
-- Order matters: run top to bottom, it's all `if not exists` so it's safe
-- to re-run.

-- =========================================================================
-- 1. PROPERTIES — the permanent record every other table hangs off of
-- =========================================================================
create table if not exists properties (
  property_id uuid primary key default gen_random_uuid(),
  address text not null,
  address_normalized text generated always as (lower(regexp_replace(address, '[^a-zA-Z0-9]', '', 'g'))) stored,
  owner_name text,
  owner_entity_type text,        -- 'individual' | 'llc' | 'trust' | 'corp' | null
  parcel_id text,
  county text,
  city text,
  zip text,
  year_built int,
  square_feet int,
  lot_size_sqft int,
  last_sale_price numeric,
  last_sale_date date,
  assessed_value numeric,
  zoning text,
  lat double precision,
  lng double precision,
  property_score int,            -- 0-100 overall lead score, recomputed by change-detector/predictions
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_properties_address_normalized on properties (address_normalized);
create index if not exists idx_properties_parcel_id on properties (parcel_id);
create index if not exists idx_properties_owner_name on properties (owner_name);
create index if not exists idx_properties_county on properties (county);

-- Backfill helper: link existing permits to a property record by matching
-- normalized address. Safe to run repeatedly.
alter table permits add column if not exists property_id uuid references properties(property_id);

-- =========================================================================
-- 2. PROPERTY TIMELINE — every dated event, one row each
-- =========================================================================
create table if not exists property_timeline (
  event_id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(property_id) on delete cascade,
  event_type text not null,      -- 'permit' | 'ownership_transfer' | 'assessment_change' |
                                  -- 'code_violation' | 'renovation' | 'sale' | 'inspection' |
                                  -- 'listing' | 'zoning_change' | 'other'
  event_date date not null,
  title text not null,
  detail text,
  source text default 'manual',  -- 'manual' | 'crawler:<name>' | 'ai_agent'
  source_ref text,               -- permit number, MLS id, doc id, etc.
  created_at timestamptz default now()
);

create index if not exists idx_timeline_property on property_timeline (property_id, event_date desc);
create index if not exists idx_timeline_type on property_timeline (event_type);

-- =========================================================================
-- 3. PROPERTY GRAPH — typed relationships between entities
--    Node ids are just text: "property:<uuid>", "owner:<name-hash>",
--    "llc:<name>", "neighborhood:<slug>", "contractor:<name>". Keeping
--    nodes as opaque text (rather than a rigid entity table per type) is
--    a deliberate simplification for v1 — an entity-resolution table is
--    the natural next step once this has real volume.
-- =========================================================================
create table if not exists property_relationships (
  relationship_id uuid primary key default gen_random_uuid(),
  from_node text not null,
  from_type text not null,       -- 'property' | 'owner' | 'llc' | 'neighborhood' | 'contractor'
  to_node text not null,
  to_type text not null,
  relationship_type text not null, -- 'owns' | 'member_of' | 'located_in' | 'performed_work_on'
  property_id uuid references properties(property_id) on delete cascade, -- convenience FK when one side is a property
  confidence numeric default 1.0,  -- 0-1, lower for inferred/fuzzy-matched links
  source text default 'manual',
  created_at timestamptz default now(),
  unique (from_node, to_node, relationship_type)
);

create index if not exists idx_graph_from on property_relationships (from_node);
create index if not exists idx_graph_to on property_relationships (to_node);
create index if not exists idx_graph_property on property_relationships (property_id);

-- =========================================================================
-- 4. CHANGE DETECTION — every property gets a rolling change_score
-- =========================================================================
create table if not exists property_changes (
  change_id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(property_id) on delete cascade,
  change_type text not null,     -- 'new_permit' | 'tax_change' | 'listing_change' |
                                  -- 'ownership_transfer' | 'zoning_update' | 'imagery_diff' |
                                  -- 'new_construction' | 'utility_permit'
  detected_at timestamptz default now(),
  magnitude numeric,              -- change-type-specific: $ delta, % delta, or 1.0 for boolean events
  detail text,
  change_score_contribution int,  -- points this single change contributes to the rollup below
  source text default 'manual'
);

create index if not exists idx_changes_property on property_changes (property_id, detected_at desc);

-- Rollup view: current change_score per property (sum of contributions in
-- the trailing 90 days, capped at 100). Recomputed on read — cheap at
-- this scale, materialize later if it isn't.
create or replace view property_change_scores as
select
  property_id,
  least(100, coalesce(sum(change_score_contribution), 0)) as change_score,
  count(*) as change_count_90d,
  max(detected_at) as last_change_at
from property_changes
where detected_at > now() - interval '90 days'
group by property_id;

-- =========================================================================
-- 5. PREDICTIVE SCORES — one row per property, overwritten each run
-- =========================================================================
create table if not exists property_predictions (
  property_id uuid primary key references properties(property_id) on delete cascade,
  renovation_probability numeric,      -- 0-1
  investor_likelihood numeric,
  sale_probability numeric,
  distress_probability numeric,
  appreciation_potential numeric,
  commercial_conversion_potential numeric,
  model_version text default 'heuristic-v1', -- honest label: rule-based until there's training data
  computed_at timestamptz default now()
);

-- =========================================================================
-- 6. CONFIDENCE ENGINE — reasons behind each prediction, so scores are
--    explainable rather than a bare number
-- =========================================================================
create table if not exists property_prediction_reasons (
  reason_id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(property_id) on delete cascade,
  prediction_field text not null,  -- e.g. 'renovation_probability'
  reason text not null,            -- e.g. 'permit spike in last 12 months'
  weight numeric,                  -- relative contribution, for sorting
  confidence numeric,              -- 0-1 confidence in this specific signal
  computed_at timestamptz default now()
);

create index if not exists idx_reasons_property on property_prediction_reasons (property_id, prediction_field);

-- =========================================================================
-- 7. NEIGHBORHOOD INTELLIGENCE — aggregates, recomputed periodically
-- =========================================================================
create table if not exists neighborhoods (
  neighborhood_id uuid primary key default gen_random_uuid(),
  name text not null,
  county text,
  city text,
  slug text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))) stored,
  created_at timestamptz default now()
);

create unique index if not exists idx_neighborhoods_slug on neighborhoods (slug);

alter table properties add column if not exists neighborhood_id uuid references neighborhoods(neighborhood_id);

create table if not exists neighborhood_stats (
  neighborhood_id uuid primary key references neighborhoods(neighborhood_id) on delete cascade,
  growth_score numeric,
  permit_velocity numeric,          -- permits per 100 properties per quarter
  avg_renovation_spend numeric,
  investor_concentration numeric,   -- % of properties owned by LLCs
  population_trend numeric,         -- external data, manual/crawler-fed
  commercial_expansion_score numeric,
  computed_at timestamptz default now()
);

-- =========================================================================
-- 8. CRAWLER RUNS — audit log for autonomous ingestion workers
-- =========================================================================
create table if not exists crawler_runs (
  run_id uuid primary key default gen_random_uuid(),
  worker_name text not null,       -- 'permits' | 'county_records' | 'tax_records' | 'listings' | 'zoning'
  status text not null,            -- 'not_configured' | 'success' | 'error' | 'partial'
  records_found int default 0,
  records_new int default 0,
  detail text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

create index if not exists idx_crawler_runs_worker on crawler_runs (worker_name, started_at desc);

-- =========================================================================
-- 9. OUTCOME TRACKING — the funnel that lets you train on revenue, not clicks
-- =========================================================================
create table if not exists lead_outcomes (
  outcome_id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(property_id) on delete cascade,
  stage text not null,             -- 'lead_generated' | 'contacted' | 'meeting_booked' |
                                    -- 'contract_signed' | 'revenue_created' | 'dead'
  stage_value numeric,             -- dollar amount when stage = 'revenue_created'
  notes text,
  occurred_at timestamptz default now()
);

create index if not exists idx_outcomes_property on lead_outcomes (property_id, occurred_at desc);
create index if not exists idx_outcomes_stage on lead_outcomes (stage);

-- =========================================================================
-- 10. SELF-EXPANSION TRACKING — which counties are live, so onboarding a
--     new one is a config change, not a rewrite
-- =========================================================================
create table if not exists counties (
  county_id uuid primary key default gen_random_uuid(),
  name text not null,
  state text not null,
  status text default 'pending',   -- 'pending' | 'importing' | 'active'
  parcel_count int default 0,
  activated_at timestamptz,
  created_at timestamptz default now(),
  unique (name, state)
);

-- =========================================================================
-- RLS — mirrors the open anon read/insert pattern already used for `permits`.
-- Tighten with a service-role requirement once this isn't single-tenant.
-- =========================================================================
alter table properties enable row level security;
alter table property_timeline enable row level security;
alter table property_relationships enable row level security;
alter table property_changes enable row level security;
alter table property_predictions enable row level security;
alter table property_prediction_reasons enable row level security;
alter table neighborhoods enable row level security;
alter table neighborhood_stats enable row level security;
alter table crawler_runs enable row level security;
alter table lead_outcomes enable row level security;
alter table counties enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['properties','property_timeline','property_relationships',
    'property_changes','property_predictions','property_prediction_reasons',
    'neighborhoods','neighborhood_stats','crawler_runs','lead_outcomes','counties']
  loop
    execute format('drop policy if exists "Allow anon read" on %I', t);
    execute format('create policy "Allow anon read" on %I for select using (true)', t);
    execute format('drop policy if exists "Allow anon insert" on %I', t);
    execute format('create policy "Allow anon insert" on %I for insert with check (true)', t);
    execute format('drop policy if exists "Allow anon update" on %I', t);
    execute format('create policy "Allow anon update" on %I for update using (true)', t);
  end loop;
end $$;
