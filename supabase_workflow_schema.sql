-- AeroLeadAI Workflow Engine: end-to-end lead lifecycle tracking.
-- Run in your Supabase project's SQL Editor, after supabase_ops_schema.sql
-- (this references contractors + jobs). Safe to re-run (idempotent).
--
-- Stage order is enforced in code (lib/workflow/pipeline.js), not by a DB
-- constraint, since new stages will get added over time. This table is the
-- single row-per-lead record the workflow sweep (/api/workflow/advance)
-- reads and advances; it's distinct from the client-side localStorage lead
-- store (lib/leadStore.js) used by the manual console, and from `jobs`
-- (created once a lead reaches DISPATCH).

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  lat double precision,
  lon double precision,
  zip text,

  stage text not null default 'discover', -- discover|analyze|qualify|contact|book|dispatch|complete|pay|review|dead
  stage_history jsonb default '[]', -- append-only [{stage, at}, ...] audit trail

  ai_score integer, -- 0-100 concern/priority score from ANALYZE
  ai_findings jsonb, -- roofAnalysis.js output: damage array + measurements + estimate
  estimate_usd numeric,
  disqualify_reason text, -- set when QUALIFY rejects the lead (stage -> dead)

  homeowner_name text,
  phone text,
  email text,

  consent boolean default false, -- set by the Bland webhook when the homeowner agrees to proceed
  requested_time timestamptz, -- appointment time the homeowner picked on the call
  bland_call_id text, -- outbound qualify-call id, once placed

  contractor_id uuid references contractors(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_leads_stage on leads (stage);
create index if not exists idx_leads_zip on leads (zip);
create index if not exists idx_leads_bland_call on leads (bland_call_id);

alter table leads enable row level security;
do $$ begin
  create policy "Allow anon read" on leads for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on leads for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon update" on leads for update using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon delete" on leads for delete using (true);
exception when duplicate_object then null; end $$;

-- Contractor portal: a real but honestly-scoped auth placeholder (see
-- README "Honest gaps") — a per-contractor unguessable code, same shape as
-- jobs.share_token, not a full login/session system. Swap for real Supabase
-- Auth (contractor-scoped rows tied to auth.uid()) before this touches
-- contractors you don't personally vouch for.
alter table contractors add column if not exists portal_access_code text unique default encode(gen_random_bytes(8), 'hex');

-- DISPATCH creates the job already `status = 'scheduled'`; these two columns
-- track the contractor's own accept/decline response to that assignment,
-- separate from the job's overall status.
alter table jobs add column if not exists contractor_response text; -- null|accepted|declined
alter table jobs add column if not exists contractor_responded_at timestamptz;

-- Stripe Connect payments (lib/contractors/payments.js), inert until you've
-- actually got a Stripe account and wired a card-collection flow (Checkout/
-- SetupIntent) that writes stripe_customer_id/stripe_payment_method_id, and
-- walked each contractor through Connect onboarding to get their
-- stripe_account_id.
alter table jobs add column if not exists stripe_customer_id text;
alter table jobs add column if not exists stripe_payment_method_id text;
alter table contractors add column if not exists stripe_account_id text;

-- Contractor portal: a copy of the lead's AI findings (roofAnalysis.js
-- output) taken at DISPATCH time, so the portal can show imagery/estimate
-- straight off the job row without joining back to leads. performance_score
-- is computed by /api/contractor/performance (acceptance rate + completion
-- rate + turnaround) and is what the DISPATCH stage ranks contractors by —
-- deliberately separate from avg_job_score, which is the average AI damage
-- score of jobs a contractor has closed, a different signal.
alter table jobs add column if not exists ai_findings jsonb;
alter table contractors add column if not exists performance_score numeric;
