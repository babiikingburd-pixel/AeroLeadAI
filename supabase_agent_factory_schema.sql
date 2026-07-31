-- AeroLeadAI Agent Factory Schema
-- Run after supabase_lessons_schema.sql.
--
-- CORE SAFETY PRINCIPLE, stated up front: agents in this system are
-- ASSEMBLED from a fixed whitelist of existing, already-built tools
-- (weather_api, permit_lookup, imagery_analysis, zip_scan). They are never
-- arbitrary code the AI writes and runs. That distinction is what keeps
-- "the system creates its own workforce" from becoming "the system runs
-- code nobody reviewed." Every table below has a hard resource bound
-- (budget, lifetime, request cap) enforced by the factory code, not left
-- as an honor-system field.

-- =========================================================================
-- AGENT_TOOLS — the fixed, human-curated whitelist. An agent spec can only
-- reference tool names that exist here. This is the actual enforcement
-- mechanism for "approved building blocks only" — not a comment, a foreign key.
-- =========================================================================
create table if not exists agent_tools (
  tool_name text primary key,
  description text,
  api_route text not null,          -- the real, existing route this tool calls
  max_calls_per_run int default 100,
  enabled boolean default true
);

insert into agent_tools (tool_name, description, api_route, max_calls_per_run) values
  ('weather_api', 'Fetch NWS storm/weather data for a location', '/api/weather-agent', 50),
  ('permit_lookup', 'Check the permit directory for an address', '/api/permit-lookup', 200),
  ('imagery_analysis', 'Fetch + score satellite/street-view imagery', '/api/imagery-agent', 100),
  ('zip_scan', 'Discover addresses in a ZIP code', '/api/zip-scan', 20),
  ('damage_scoring', 'Run the Analyst/Critic/Teacher scoring pipeline', '/api/damage-agent', 100)
on conflict (tool_name) do nothing;

-- =========================================================================
-- AGENT_SPECS — a created agent, assembled from the tool whitelist. Budget
-- and lifetime are hard caps checked by the factory before every run, not
-- just metadata.
-- =========================================================================
create table if not exists agent_specs (
  agent_id uuid primary key default gen_random_uuid(),
  name text not null,
  goal text not null,
  tools text[] not null,             -- must all exist in agent_tools
  budget numeric not null default 5.00,     -- max USD spend, hard cap
  spent numeric not null default 0,
  lifetime_hours int not null default 24,
  max_requests int not null default 1000,
  requests_made int not null default 0,
  status text default 'active',      -- 'active' | 'expired' | 'retired' | 'exhausted'
  generation int default 1,
  parent_agent_id uuid references agent_specs(agent_id),
  created_at timestamptz default now(),
  -- Plain column, not generated: `timestamptz + interval` isn't immutable
  -- (Postgres rejects it in a stored generated column since the result
  -- depends on the session timezone), so the app computes and sets this
  -- explicitly at insert time (see lib/agentFactory.js create()).
  expires_at timestamptz,
  retired_at timestamptz,
  retired_reason text
);

create index if not exists idx_agent_specs_status on agent_specs (status) where status = 'active';
create index if not exists idx_agent_specs_generation on agent_specs (generation);

-- =========================================================================
-- AGENT_GENOME — the evolution ledger. One row per agent per evaluation,
-- tracking real measured performance (not self-reported). "Revenue" here
-- means leads produced above a hot-tier threshold, since this system has
-- no actual sales-close data — stated honestly, not inflated.
-- =========================================================================
create table if not exists agent_genome (
  genome_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_specs(agent_id) on delete cascade,
  parent_id uuid references agent_specs(agent_id),
  strategy text,                     -- description of what this agent/generation does differently
  hot_leads_found int default 0,     -- real proxy metric: predictions >=75 this agent's runs produced
  properties_scanned int default 0,
  accuracy numeric,                  -- avg error_magnitude of this agent's resolved predictions, if any
  generation int default 1,
  evaluated_at timestamptz default now()
);

create index if not exists idx_agent_genome_agent on agent_genome (agent_id, evaluated_at desc);

-- =========================================================================
-- AGENT_RUNS — one row per actual execution of an agent, so budget/request
-- consumption is auditable, not just a running counter that could drift.
-- =========================================================================
create table if not exists agent_runs (
  run_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_specs(agent_id) on delete cascade,
  tool_name text not null references agent_tools(tool_name),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,                       -- 'success' | 'failed'
  cost numeric default 0,
  result_summary text
);

create index if not exists idx_agent_runs_agent on agent_runs (agent_id, started_at desc);

-- =========================================================================
-- RESEARCH_PROPOSALS — Level 5, deliberately built as OBSERVE + PROPOSE
-- ONLY. A research agent can write a row here describing what it found and
-- what it recommends. It can NEVER set status to 'approved' or 'deployed'
-- itself — those transitions require a human via the UI/API, enforced by
-- application code that simply doesn't expose a self-approval path.
-- =========================================================================
create table if not exists research_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  triggered_by text,                 -- what observation spawned this research agent
  domain text,
  hypothesis text,
  findings text,
  proposed_change text,
  simulation_result text,            -- if a backtest against historical predictions was run
  status text default 'pending_human_approval',  -- 'pending_human_approval' | 'approved' | 'rejected' | 'deployed'
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists idx_research_proposals_status on research_proposals (status) where status = 'pending_human_approval';

-- =========================================================================
-- Link predictions back to the agent that produced them (nullable — most
-- predictions still come from direct user scans, not an agent). This is
-- the real fix for the evolution engine's metrics: without this column,
-- "hot leads found by agent X" has no honest way to be computed at all.
-- =========================================================================
alter table predictions add column if not exists agent_id uuid references agent_specs(agent_id);
create index if not exists idx_predictions_agent on predictions (agent_id) where agent_id is not null;

alter table agent_tools enable row level security;
alter table agent_specs enable row level security;
alter table agent_genome enable row level security;
alter table agent_runs enable row level security;
alter table research_proposals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agent_tools','agent_specs','agent_genome','agent_runs','research_proposals']
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
-- HONEST SCOPE, stated plainly:
-- - Agents are ASSEMBLED from agent_tools only. There is no code-generation
--   path anywhere in this system. "Create its own crawlers" means "combine
--   existing, already-reviewed API calls into a named, budgeted plan" — not
--   "write and execute new code." That's a deliberate, permanent boundary,
--   not a phase-1 limitation to be lifted later.
-- - research_proposals never self-approves. No application code path exists
--   that flips status from pending_human_approval to approved/deployed
--   without a human-initiated request. This is enforced by NOT BUILDING
--   that path, which is the only reliable enforcement for a boundary like
--   this — a flag an agent could theoretically flip is not a boundary.
-- =========================================================================
