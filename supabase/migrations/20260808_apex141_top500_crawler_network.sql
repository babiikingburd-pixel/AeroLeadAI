-- APEX 14.1 — RESIDENTIAL TOP-500 CRAWLER NETWORK
-- Complete persistent investigation network for the 500 slots.
-- Logical crawlers are persisted as work items; a shared worker pool executes them.
-- No synthetic evidence is created. Existing real endpoints are reused.

alter table if exists batch_leads
  add column if not exists residential_status text default 'unknown',
  add column if not exists residential_confidence numeric default 0,
  add column if not exists property_use_type text,
  add column if not exists development_signal numeric default 0,
  add column if not exists top500_slot integer,
  add column if not exists top500_slot_state text default 'none',
  add column if not exists top500_investigation_score numeric default 0,
  add column if not exists top500_last_investigated_at timestamptz,
  add column if not exists top500_next_investigation_at timestamptz,
  add column if not exists top500_evidence_version text;

create index if not exists idx_batch_leads_residential_rank
  on batch_leads(residential_status, priority_score desc, confidence_score desc);

create table if not exists top500_slots (
  slot_no integer primary key check (slot_no between 1 and 500),
  property_id text references batch_leads(id) on delete set null,
  rank integer,
  score numeric default 0,
  evidence_confidence numeric default 0,
  evidence_completeness numeric default 0,
  residential_confidence numeric default 0,
  status text not null default 'open',
  assigned_at timestamptz,
  last_competed_at timestamptz,
  last_investigated_at timestamptz,
  next_investigation_at timestamptz,
  replacement_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists ux_top500_slots_property
  on top500_slots(property_id) where property_id is not null;

create table if not exists top500_crawler_lanes (
  lane_name text primary key,
  enabled boolean not null default true,
  interval_seconds integer not null default 900,
  priority integer not null default 50,
  description text
);

insert into top500_crawler_lanes(lane_name,interval_seconds,priority,description) values
 ('residential', 900, 100, 'Continuously prove residential eligibility and detect commercial exclusions.'),
 ('permits', 1800, 95, 'Complete permit-history sweep and persist individual permit evidence.'),
 ('storm', 1800, 90, 'Refresh storm/hail/wind evidence and event proximity.'),
 ('imagery', 1800, 90, 'Refresh available imagery and persist visual evidence metadata.'),
 ('damage', 3600, 85, 'Run real roof/exterior damage analysis when imagery is available.'),
 ('development', 3600, 80, 'Look for residential-development / cluster signals in stored evidence.'),
 ('competition', 900, 110, 'Re-evaluate slot versus challengers and trigger replacement when beaten.')
on conflict(lane_name) do update set interval_seconds=excluded.interval_seconds,
  priority=excluded.priority, description=excluded.description, enabled=true;

create table if not exists top500_crawler_tasks (
  task_id uuid primary key default gen_random_uuid(),
  slot_no integer not null references top500_slots(slot_no) on delete cascade,
  property_id text not null references batch_leads(id) on delete cascade,
  lane_name text not null references top500_crawler_lanes(lane_name),
  priority numeric default 0,
  status text not null default 'queued',
  available_at timestamptz default now(),
  attempts integer default 0,
  max_attempts integer default 5,
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  next_run_at timestamptz,
  result jsonb default '{}'::jsonb,
  last_error text,
  evidence_written integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_top500_tasks_ready
  on top500_crawler_tasks(status, priority desc, available_at);

create index if not exists idx_top500_tasks_slot
  on top500_crawler_tasks(slot_no, lane_name, created_at desc);

create table if not exists top500_crawler_findings (
  finding_id uuid primary key default gen_random_uuid(),
  slot_no integer not null references top500_slots(slot_no) on delete cascade,
  property_id text not null references batch_leads(id) on delete cascade,
  lane_name text not null,
  source text,
  source_ref text,
  observed_at timestamptz default now(),
  claim text,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric default 0,
  verification_status text default 'unverified',
  created_at timestamptz default now()
);

create index if not exists idx_top500_findings_property
  on top500_crawler_findings(property_id, observed_at desc);

create index if not exists idx_top500_findings_lane
  on top500_crawler_findings(lane_name, observed_at desc);

-- Atomic queue claim: multiple external workers may run concurrently without
-- taking the same task.
create or replace function claim_top500_crawler_tasks(p_worker_id text, p_limit integer default 4)
returns setof top500_crawler_tasks
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
begin
  return query
  with picked as (
    select task_id
    from top500_crawler_tasks
    where status='queued'
      and available_at <= now()
      and attempts < max_attempts
    order by priority desc, available_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,4),20))
  )
  update top500_crawler_tasks t
     set status='running',
         locked_by=p_worker_id,
         locked_at=now(),
         started_at=now(),
         attempts=t.attempts+1
    from picked
   where t.task_id=picked.task_id
  returning t.*;
end;
$$;

revoke all on function claim_top500_crawler_tasks(text,integer) from public,anon,authenticated;
grant execute on function claim_top500_crawler_tasks(text,integer) to service_role;

-- Ensure one current task exists for every active slot/lane. This is intentionally
-- idempotent; it can be called every cycle.
create or replace function ensure_top500_crawler_tasks()
returns integer
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare inserted_count integer := 0;
begin
  insert into top500_crawler_tasks(slot_no,property_id,lane_name,priority,available_at,next_run_at)
  select s.slot_no,s.property_id,l.lane_name,
         l.priority + greatest(0,500-coalesce(s.rank,500)),
         coalesce(s.next_investigation_at,now()),
         coalesce(s.next_investigation_at,now())
    from top500_slots s
    cross join top500_crawler_lanes l
   where s.status='occupied'
     and s.property_id is not null
     and l.enabled
     and not exists (
       select 1 from top500_crawler_tasks q
        where q.slot_no=s.slot_no and q.property_id=s.property_id
          and q.lane_name=l.lane_name
          and coalesce(q.next_run_at,q.finished_at,q.created_at) > now()
     );
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function ensure_top500_crawler_tasks() from public,anon,authenticated;
grant execute on function ensure_top500_crawler_tasks() to service_role;

-- Complete old task records are intentionally retained. This function only
-- reopens a lane when its scheduled interval has elapsed.
create or replace function schedule_due_top500_lanes()
returns integer
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare n integer := 0;
begin
  insert into top500_crawler_tasks(slot_no,property_id,lane_name,priority,available_at,next_run_at)
  select s.slot_no,s.property_id,l.lane_name,
         l.priority + greatest(0,500-coalesce(s.rank,500)),
         now(), now()
    from top500_slots s
    cross join top500_crawler_lanes l
   where s.status='occupied' and s.property_id is not null and l.enabled
     and not exists (
       select 1 from top500_crawler_tasks q
        where q.slot_no=s.slot_no and q.property_id=s.property_id
          and q.lane_name=l.lane_name
          and coalesce(q.next_run_at,q.finished_at,q.created_at) > now()
     );
  get diagnostics n=row_count;
  return n;
end;
$$;

revoke all on function schedule_due_top500_lanes() from public,anon,authenticated;
grant execute on function schedule_due_top500_lanes() to service_role;

-- No anon/authenticated policies: nothing in the app queries these tables
-- from the browser (client code only ever goes through supabaseServer(),
-- the service-role client, in app/api/twincities/*). top500_crawler_findings
-- carries real addresses plus damage/permit evidence about specific
-- properties, and top500_crawler_tasks carries worker ids and error
-- messages -- neither belongs behind the public anon key. Same
-- RLS-enabled-no-policy, service-role-only pattern already used for
-- crawler_runs and evidence_queue.
alter table top500_slots enable row level security;
alter table top500_crawler_lanes enable row level security;
alter table top500_crawler_tasks enable row level security;
alter table top500_crawler_findings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['top500_slots','top500_crawler_lanes','top500_crawler_tasks','top500_crawler_findings']
  loop
    execute format('drop policy if exists "Allow anon read" on %I',t);
  end loop;
end $$;
