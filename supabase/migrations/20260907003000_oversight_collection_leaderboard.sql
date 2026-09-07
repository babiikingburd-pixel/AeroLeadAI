-- Collection mode publishes a property as soon as its real county identity,
-- structure coordinates and privately stored imagery exist. Doctor and
-- GateKeeper remain audit/enrichment layers; missing permit, weather, image
-- date or analysis evidence must never suppress the collection lead deck.
create or replace function public.refresh_oversight_leaderboard()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  with gate_calc as (
    select
      p.parcel_id,
      coalesce(a.audit_complete, false) as audit_complete,
      coalesce(a.completion_pct, 0) as doctor_completion,
      coalesce((
        select bool_and((item->>'complete')::boolean)
        from jsonb_array_elements(coalesce(a.checklist, '[]'::jsonb)) item
        where item->>'key' in ('identity','geolocation','property_classification','year_built','imagery_capture','permit_history')
      ), false) as core_ready,
      nullif(btrim(p.parcel_id), '') is not null
        and nullif(btrim(p.address), '') is not null
        and exists (
          select 1
          from public.evidence_records structure
          where structure.parcel_id = p.parcel_id
            and structure.type = 'STRUCTURE'
            and structure.reality in ('REAL_NOW','CACHED_REAL')
            and structure.payload->>'latitude' is not null
            and structure.payload->>'longitude' is not null
        )
        and exists (
          select 1
          from public.evidence_records imagery
          where imagery.parcel_id = p.parcel_id
            and imagery.type = 'IMAGERY'
            and imagery.reality in ('REAL_NOW','CACHED_REAL')
            and coalesce(imagery.payload->>'storage_path', '') <> ''
        ) as collection_ready
    from public.roof_profiles p
    left join public.oversight_property_audits a on a.parcel_id = p.parcel_id
  )
  update public.roof_profiles p
  set leaderboard_eligible = g.collection_ready,
      doctor_gate_status = case when g.audit_complete then 'CERTIFIED' when g.core_ready then 'ELIGIBLE' else 'REPAIRING' end,
      rank_score = round(greatest(0, least(100,
        coalesce(p.commercial_priority, p.opportunity, 0) * 0.60
        + coalesce(p.evidence_confidence, 0) * 100 * 0.20
        + coalesce(g.doctor_completion, p.completion_pct, 0) * 0.20
      )), 2),
      ranked_at = now()
  from gate_calc g
  where p.parcel_id = g.parcel_id;

  update public.roof_profiles set live_rank = null where live_rank is not null;
  with ranked as (
    select parcel_id,
      row_number() over (order by rank_score desc, evidence_confidence desc nulls last, updated_at desc, parcel_id) as rn
    from public.roof_profiles
    where leaderboard_eligible
  )
  update public.roof_profiles p
  set live_rank = r.rn,
      deep_dive_tier = case when r.rn <= 100 then 'TOP_100' when r.rn <= 500 then 'TOP_500' else p.deep_dive_tier end,
      ranked_at = now()
  from ranked r
  where p.parcel_id = r.parcel_id;

  update public.roof_profiles
  set deep_dive_tier = case when leaderboard_eligible then deep_dive_tier else null end
  where not leaderboard_eligible and deep_dive_tier in ('TOP_100','TOP_500');
end;
$$;

revoke all on function public.refresh_oversight_leaderboard() from public, anon, authenticated;
grant execute on function public.refresh_oversight_leaderboard() to service_role;

select public.refresh_oversight_leaderboard();
