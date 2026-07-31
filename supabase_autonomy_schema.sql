-- AeroLeadAI Autonomy Schema — the memory + prediction tables that make
-- "learning from mistakes" a real, measurable fact instead of a claim.
--
-- Core idea, stated plainly: a prediction ("roof damage risk: 82%") is
-- worthless as a learning signal until it's compared against an outcome
-- ("actual result: 91%, error: 9%"). This schema stores BOTH sides of that,
-- permanently, so accuracy over time is a real SQL query, not a guess.
--
-- Run in Supabase SQL editor, after supabase_property_images_schema.sql.

-- =========================================================================
-- 1. PREDICTIONS — every score the system produces, timestamped, permanent.
-- Never overwritten. A property scanned 5 times has 5 rows here, not 1.
-- =========================================================================
create table if not exists predictions (
  prediction_id uuid primary key default gen_random_uuid(),
  address_normalized text not null,
  address text,
  domain text not null,              -- 'roof' | 'tree' | 'driveway' | 'snow_load'
  predicted_score int not null,      -- 0-100 concern/risk score at time of prediction
  confidence text,                   -- 'low' | 'medium' | 'high'
  provider text,                     -- which AI model produced this (groq/anthropic)
  notes text,
  predicted_at timestamptz default now(),
  -- outcome fields, filled in later by the evaluation loop or manual correction
  actual_score int,                  -- what actually happened (inspection result,
                                      -- contractor report, permit filed, etc.)
  outcome_source text,               -- 'manual_correction' | 'permit_confirmed' |
                                      -- 'inspection_report' | 'no_followup'
  outcome_recorded_at timestamptz,
  error_magnitude int generated always as (
    case when actual_score is not null then abs(predicted_score - actual_score) else null end
  ) stored
);

create index if not exists idx_predictions_address on predictions (address_normalized);
create index if not exists idx_predictions_domain on predictions (domain, predicted_at desc);
create index if not exists idx_predictions_unresolved on predictions (predicted_at) where actual_score is null;

-- =========================================================================
-- 2. CORRECTIONS — every time a human overrides a prediction. This is the
-- highest-value learning signal there is: a person looked at the same
-- evidence the AI did and said "no, actually." Every prompt-calibration
-- improvement should trace back to rows here.
-- =========================================================================
create table if not exists corrections (
  correction_id uuid primary key default gen_random_uuid(),
  prediction_id uuid references predictions(prediction_id) on delete set null,
  address_normalized text not null,
  domain text,
  original_score int,
  corrected_score int not null,
  reason text,
  corrected_by text default 'user',
  created_at timestamptz default now()
);

create index if not exists idx_corrections_address on corrections (address_normalized);

-- =========================================================================
-- 3. CRAWLER RUNS — one row per scheduled job execution. This is the audit
-- trail the self-evaluation loop reads to answer "which crawler failed?"
-- and "which sources changed?" honestly, from real data, not assumption.
-- =========================================================================
create table if not exists crawler_runs (
  run_id uuid primary key default gen_random_uuid(),
  crawler_name text not null,        -- 'permit' | 'weather' | 'zip_scan' | 'imagery' | etc.
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,                       -- 'success' | 'partial' | 'failed'
  items_processed int default 0,
  items_succeeded int default 0,
  items_failed int default 0,
  duration_ms int,
  error_summary text
);

create index if not exists idx_crawler_runs_name on crawler_runs (crawler_name, started_at desc);

-- =========================================================================
-- 4. SYSTEM INSIGHTS — the self-evaluation loop's own journal. Every 30-min
-- cycle writes one row answering "what did I learn / what's stale / what
-- should change." This is the audit trail for the optimization engine's
-- decisions, so "the system fixed itself" is inspectable, not a black box.
-- =========================================================================
create table if not exists system_insights (
  insight_id uuid primary key default gen_random_uuid(),
  cycle_at timestamptz default now(),
  category text,                     -- 'accuracy' | 'crawler_health' | 'stale_data' | 'optimization'
  summary text not null,
  detail jsonb,
  action_taken text                  -- what the optimizer actually did in response, if anything
);

create index if not exists idx_system_insights_cycle on system_insights (cycle_at desc);

-- =========================================================================
-- 5. ACCURACY ROLLUPS — precomputed per-domain accuracy, refreshed each
-- cycle. This is the number "is the model getting better" actually means —
-- avg error magnitude over the trailing N resolved predictions, per domain.
-- =========================================================================
create table if not exists accuracy_rollups (
  domain text primary key,
  resolved_count int default 0,
  avg_error numeric,
  avg_error_last_30d numeric,
  trend text,                         -- 'improving' | 'stable' | 'degrading' | 'insufficient_data'
  last_computed_at timestamptz default now()
);

alter table predictions enable row level security;
alter table corrections enable row level security;
alter table crawler_runs enable row level security;
alter table system_insights enable row level security;
alter table accuracy_rollups enable row level security;

do $$
declare t text;
begin
  foreach t in array array['predictions','corrections','crawler_runs','system_insights','accuracy_rollups']
  loop
    execute format('drop policy if exists "Allow anon read" on %I', t);
    execute format('create policy "Allow anon read" on %I for select using (true)', t);
    execute format('drop policy if exists "Allow anon insert" on %I', t);
    execute format('create policy "Allow anon insert" on %I for insert with check (true)', t);
    execute format('drop policy if exists "Allow anon update" on %I', t);
    execute format('create policy "Allow anon update" on %I for update using (true)', t);
  end loop;
end $$;

-- =========================================================================
-- HONEST GAP, stated plainly: this schema stores predictions and their
-- outcomes so accuracy is measurable — but "actual_score" doesn't fill
-- itself in. Real ground truth (did the roof actually get replaced? was
-- there actually storm damage a contractor confirmed?) has to come from
-- somewhere: a manual correction, a confirmed permit, a follow-up
-- inspection. Nothing in this system can invent ground truth it was never
-- given. The self-evaluation loop below is honest about this: it reports
-- "N predictions unresolved, can't compute accuracy yet" rather than
-- pretending resolution when there isn't any.
-- =========================================================================
