alter table public.roof_profiles add column if not exists live_rank integer;
alter table public.roof_profiles add column if not exists leaderboard_eligible boolean not null default false;
alter table public.roof_profiles add column if not exists doctor_gate_status text not null default 'REPAIRING' check (doctor_gate_status in ('REPAIRING','ELIGIBLE','CERTIFIED'));
alter table public.roof_profiles add column if not exists rank_score numeric not null default 0;
alter table public.roof_profiles add column if not exists ranked_at timestamptz;

create index if not exists roof_profiles_live_rank_idx on public.roof_profiles(live_rank) where live_rank is not null;
create index if not exists roof_profiles_leaderboard_idx on public.roof_profiles(leaderboard_eligible, rank_score desc, evidence_confidence desc);

create or replace function public.refresh_oversight_leaderboard()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  with gate_calc as (
    select p.parcel_id, a.audit_complete, a.completion_pct as doctor_completion,
      coalesce((select bool_and((item->>'complete')::boolean)
        from jsonb_array_elements(a.checklist) item
        where item->>'key' in ('identity','geolocation','property_classification','year_built','imagery_capture','permit_history')), false) as core_ready
    from public.roof_profiles p
    left join public.oversight_property_audits a on a.parcel_id = p.parcel_id
  )
  update public.roof_profiles p
  set leaderboard_eligible = g.core_ready,
      doctor_gate_status = case when g.audit_complete then 'CERTIFIED' when g.core_ready then 'ELIGIBLE' else 'REPAIRING' end,
      rank_score = round(greatest(0, least(100,
        coalesce(p.commercial_priority, p.opportunity, 0) * 0.60
        + coalesce(p.evidence_confidence, 0) * 100 * 0.20
        + coalesce(g.doctor_completion, p.completion_pct, 0) * 0.20
      )), 2),
      ranked_at = now()
  from gate_calc g where p.parcel_id = g.parcel_id;

  update public.roof_profiles set live_rank = null where live_rank is not null;
  with ranked as (
    select parcel_id, row_number() over (order by rank_score desc, evidence_confidence desc nulls last, updated_at desc, parcel_id) as rn
    from public.roof_profiles where leaderboard_eligible
  )
  update public.roof_profiles p
  set live_rank = r.rn,
      deep_dive_tier = case when r.rn <= 100 then 'TOP_100' when r.rn <= 500 then 'TOP_500' else p.deep_dive_tier end,
      ranked_at = now()
  from ranked r where p.parcel_id = r.parcel_id;

  update public.roof_profiles
  set deep_dive_tier = case when leaderboard_eligible then deep_dive_tier else null end
  where not leaderboard_eligible and deep_dive_tier in ('TOP_100','TOP_500');
end;
$$;

revoke all on function public.refresh_oversight_leaderboard() from public, anon, authenticated;
grant execute on function public.refresh_oversight_leaderboard() to service_role;

create or replace function public.refresh_oversight_leaderboard_from_audit()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin perform public.refresh_oversight_leaderboard(); return coalesce(new, old); end;
$$;
revoke all on function public.refresh_oversight_leaderboard_from_audit() from public, anon, authenticated;
grant execute on function public.refresh_oversight_leaderboard_from_audit() to service_role;

drop trigger if exists oversight_leaderboard_audit_trigger on public.oversight_property_audits;
create trigger oversight_leaderboard_audit_trigger after insert or update or delete on public.oversight_property_audits
for each statement execute function public.refresh_oversight_leaderboard_from_audit();

create or replace function public.refresh_oversight_leaderboard_from_profile()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin perform public.refresh_oversight_leaderboard(); return coalesce(new, old); end;
$$;
revoke all on function public.refresh_oversight_leaderboard_from_profile() from public, anon, authenticated;
grant execute on function public.refresh_oversight_leaderboard_from_profile() to service_role;

drop trigger if exists oversight_leaderboard_profile_trigger on public.roof_profiles;
create trigger oversight_leaderboard_profile_trigger after insert or update of commercial_priority, opportunity, evidence_confidence, completion_pct on public.roof_profiles
for each statement execute function public.refresh_oversight_leaderboard_from_profile();

select public.refresh_oversight_leaderboard();