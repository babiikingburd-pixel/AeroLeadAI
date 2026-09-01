create table if not exists public.oversight_crawler_jobs (
  id uuid primary key default gen_random_uuid(),
  parcel_id text not null references public.roof_profiles(parcel_id) on delete cascade,
  worker_group text not null check (worker_group in ('A','B')),
  engine_type text not null,
  requirement text not null,
  priority integer not null default 50,
  rank_tier text not null default 'UNRANKED',
  status text not null default 'READY' check (status in ('READY','RUNNING','DONE','RETRY','SKIPPED','FAILED')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists oversight_crawler_jobs_active_dedupe on public.oversight_crawler_jobs(parcel_id, engine_type, requirement) where status in ('READY','RUNNING','RETRY');
create index if not exists oversight_crawler_jobs_pick_idx on public.oversight_crawler_jobs(worker_group,status,next_attempt_at,priority desc);
alter table public.oversight_crawler_jobs enable row level security;
revoke all on public.oversight_crawler_jobs from anon, authenticated;

create table if not exists public.oversight_crawler_runs (
  id uuid primary key default gen_random_uuid(),
  worker_group text not null,
  engine_type text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempted integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.oversight_crawler_runs enable row level security;
revoke all on public.oversight_crawler_runs from anon, authenticated;

create or replace function public.seed_oversight_crawler_jobs()
returns jsonb language plpgsql security definer set search_path=public as $$
declare inserted_a int := 0; inserted_b int := 0;
begin
  insert into public.oversight_crawler_jobs(parcel_id,worker_group,engine_type,requirement,priority,rank_tier)
  select p.parcel_id,'A',case when t.requirement='identity' then 'identity_resolver' else 'property_assessor' end,t.requirement,
    greatest(t.priority,case when p.live_rank between 1 and 20 then 100 when p.live_rank between 21 and 100 then 90 when p.live_rank between 101 and 500 then 75 else 50 end),
    case when p.live_rank between 1 and 20 then 'TOP20' when p.live_rank between 21 and 100 then 'TOP100' when p.live_rank between 101 and 500 then 'TOP500' else 'UNRANKED' end
  from public.oversight_audit_tasks t join public.roof_profiles p using(parcel_id)
  where t.status='READY' and t.requirement in ('identity','property_classification','year_built','permit_history')
    and not (t.requirement='identity' and exists(select 1 from public.evidence_records e where e.parcel_id=t.parcel_id and e.type='PROPERTY' and e.reality in ('REAL_NOW','CACHED_REAL') and e.confidence >= .85))
  on conflict do nothing;
  get diagnostics inserted_a = row_count;

  insert into public.oversight_crawler_jobs(parcel_id,worker_group,engine_type,requirement,priority,rank_tier)
  select p.parcel_id,'B',case when t.requirement='weather_history' then 'weather' when t.requirement in ('imagery_capture','imagery_date') then 'imagery_acquisition' else 'imagery_analysis' end,t.requirement,
    greatest(t.priority,case when p.live_rank between 1 and 20 then 100 when p.live_rank between 21 and 100 then 92 when p.live_rank between 101 and 500 then 78 else 55 end),
    case when p.live_rank between 1 and 20 then 'TOP20' when p.live_rank between 21 and 100 then 'TOP100' when p.live_rank between 101 and 500 then 'TOP500' else 'UNRANKED' end
  from public.oversight_audit_tasks t join public.roof_profiles p using(parcel_id)
  where t.status='READY' and t.requirement in ('weather_history','imagery_capture','imagery_date','imagery_analysis')
  on conflict do nothing;
  get diagnostics inserted_b = row_count;
  return jsonb_build_object('groupA',inserted_a,'groupB',inserted_b);
end $$;
revoke all on function public.seed_oversight_crawler_jobs() from public;
revoke all on function public.seed_oversight_crawler_jobs() from anon, authenticated;
