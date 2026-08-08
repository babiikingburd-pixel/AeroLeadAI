-- This supersedes 20260805_apex100_global_rank.sql. Do not run that file
-- alone against a fresh database — apply this one instead (or after it).
--
-- Four defects fixed relative to the version shipped in the 9.9-10.0 zip:
--   1. Fusion score was computed twice with two different formulas (rank vs.
--      stored value disagreed — the ranking included a +8 corroboration
--      bonus the stored evidence_fusion_score omitted). Now one CTE, reused.
--   2. Rewrote all 152,203 rows every call. Now only changed rows are written.
--   3. Did not consult promotion_streak, so a lead could flip top500 <->
--      demoted every single cycle. Promotion now requires the streak to
--      clear PROMOTE_STABILITY_CYCLES (matches lib/twincities/evidenceDebt.js).
--   4. SECURITY DEFINER with no execute revoke — callable by anon/authenticated
--      via /rest/v1/rpc/. Changed to SECURITY INVOKER, search_path pinned,
--      execute restricted to postgres/service_role.
--
-- Already applied directly to dikxsdjlrbdowozjkefw by Claude on 2026-08-05.
-- This file exists so the corrected function ships with the codebase instead
-- of living only as an ad hoc migration run against one database.

create or replace function apex10_rebuild_leaderboard(
  p_cycle_id text,
  p_limit integer default 500,
  p_stability_cycles integer default 2
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_scanned integer := 0;
  v_top integer := 0;
  v_promoted integer := 0;
  v_demoted integer := 0;
begin
  insert into twincities_apex_cycles(cycle_id, version, status)
  values (p_cycle_id, 'APEX10.0', 'running')
  on conflict (cycle_id) do nothing;

  with scored as (
    select
      id,
      apex_tier as old_tier,
      apex_rank as old_rank,
      coalesce(promotion_streak, 0) as streak,
      (case when permit_evidence_status in ('verified','none_found') then 1 else 0 end
     + case when value_evidence_status = 'verified' or assessed_value is not null then 1 else 0 end
     + case when storm_evidence_status = 'verified' or hail_inches is not null
                 or wind_mph is not null or storm_date is not null then 1 else 0 end
     + case when image_review_status in ('verified','adjudicated') then 1 else 0 end) as corroboration,
      least(100, greatest(0,
          (case when permit_evidence_status in ('verified','none_found') then 20 else 0 end)
        + (case when value_evidence_status = 'verified' or assessed_value is not null then 20 else 0 end)
        + (case when storm_evidence_status = 'verified' or hail_inches is not null
                     or wind_mph is not null or storm_date is not null then 20 else 0 end)
        + (case when image_review_status in ('verified','adjudicated') then 25 else 0 end)
        + (case when image_review_status in ('verified','adjudicated')
                then least(15, coalesce(image_review_confidence,0)*0.10
                              + coalesce(image_visibility_score,0)*0.05) else 0 end)
      )) as eq,
      coalesce(priority_score,0) * 0.55
        + case when storm_evidence_status = 'verified' or hail_inches is not null
                    or wind_mph is not null or storm_date is not null then 25 else 0 end
        + case when image_review_status in ('verified','adjudicated')
               then least(45, coalesce(image_damage_score,0)
                            * least(1, coalesce(image_review_confidence,0)/70.0) * 0.45)
               else 0 end as fused_base
    from batch_leads
  ),
  fused as (
    select s.*,
           least(100, greatest(0, s.fused_base + case when s.corroboration >= 2 then 8 else 0 end)) as fusion,
           least(100, greatest(0, s.eq * 0.65
                 + case when s.corroboration >= 2 then 20 when s.corroboration = 1 then 10 else 0 end)) as conf
    from scored s
  ),
  ranked as (
    select f.*, row_number() over (order by f.fusion desc, f.eq desc, f.id) as rn
    from fused f
  ),
  decided as (
    select r.*,
           (r.rn <= p_limit and r.conf >= 70 and r.eq >= 65) as qualifies,
           case when r.rn <= p_limit and r.conf >= 70 and r.eq >= 65
                then least(r.streak + 1, p_stability_cycles) else 0 end as new_streak
    from ranked r
  ),
  final as (
    select d.*,
           case when d.qualifies and d.new_streak >= p_stability_cycles then 'top500'
                when d.conf >= 55 and d.eq >= 55 then 'top500_candidate'
                else 'watch' end as new_tier
    from decided d
  ),
  upd as (
    update batch_leads b set
      apex_rank = f.rn,
      promotion_streak = f.new_streak,
      evidence_quality_score = f.eq,
      evidence_fusion_score = f.fusion,
      evidence_fusion_confidence = f.conf,
      evidence_fusion_version = 'APEX10.0',
      last_fused_at = now(),
      apex_tier = f.new_tier,
      apex_decision = case
        when f.new_tier = 'top500' and coalesce(b.apex_tier,'') <> 'top500' then 'promoted'
        when coalesce(b.apex_tier,'') = 'top500' and f.new_tier <> 'top500' then 'demoted'
        else 'held' end,
      apex_decided_at = now(),
      apex_governance_version = 'APEX10.0'
    from final f
    where b.id = f.id
      and (b.apex_rank is distinct from f.rn
        or b.apex_tier is distinct from f.new_tier
        or b.evidence_fusion_score is distinct from f.fusion
        or coalesce(b.promotion_streak,0) is distinct from f.new_streak)
    returning b.id, b.apex_decision
  )
  select count(*),
         count(*) filter (where apex_decision = 'promoted'),
         count(*) filter (where apex_decision = 'demoted')
    into v_scanned, v_promoted, v_demoted
  from upd;

  select count(*) into v_top from batch_leads where apex_tier = 'top500';

  update twincities_apex_cycles
     set status='completed', completed_at=now(),
         scanned=v_scanned, fused=v_scanned, promoted=v_promoted, demoted=v_demoted,
         notes=jsonb_build_object('top500', v_top, 'stability_cycles', p_stability_cycles)
   where cycle_id = p_cycle_id;

  return jsonb_build_object('changed', v_scanned, 'promoted', v_promoted,
                            'demoted', v_demoted, 'top500', v_top);
end;
$$;

revoke all on function apex10_rebuild_leaderboard(text, integer, integer) from public, anon, authenticated;
grant execute on function apex10_rebuild_leaderboard(text, integer, integer) to postgres, service_role;
