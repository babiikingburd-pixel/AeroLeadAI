-- APEX 10.0 server-side global ranking.
--
-- Supersedes 20260805_apex100_global_rank.sql, which has been removed from
-- this directory. That file declared apex10_rebuild_leaderboard(text,integer)
-- — a DIFFERENT signature from the one below, so `create or replace` here
-- does not overwrite it. Any database that ran it still has a two-argument
-- SECURITY DEFINER copy sitting in `public`, callable by anon through
-- /rest/v1/rpc/, which rewrites all 152K rows of batch_leads. The explicit
-- drop below removes it.
--
-- Defects fixed relative to the version shipped in the 9.9-10.0 zip:
--   1. Fusion score was computed twice from two different formulas, so the
--      ranking and the stored evidence_fusion_score disagreed. One CTE now,
--      reused.
--   2. Rewrote all 152,203 rows on every call. Only changed rows are written.
--   3. Ignored promotion_streak, so a lead could flip top500 <-> demoted every
--      cycle. Promotion now requires the streak to clear
--      PROMOTE_STABILITY_CYCLES (matches lib/twincities/evidenceDebt.js).
--   4. SECURITY DEFINER with no execute revoke. Now SECURITY INVOKER,
--      search_path pinned, execute restricted to postgres/service_role.
--   5. The scoring math disagreed with lib/twincities/evidenceFusion.js, which
--      writes the SAME four columns from /api/twincities/evidence-fusion. Two
--      writers, two answers, last-write-wins. This function is now a literal
--      transcription of fuseEvidence(): same corroboration set (storm,
--      reviewed image, permit-within-10y), same confidence terms including the
--      image_review_confidence * 0.15 the SQL had dropped, same challenger
--      score, same clamping and 2-decimal rounding. Change one, change both.

drop function if exists apex10_rebuild_leaderboard(text, integer);

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
  v_changed  integer := 0;
  v_promoted integer := 0;
  v_demoted  integer := 0;
  v_top      integer := 0;
begin
  insert into twincities_apex_cycles(cycle_id, version, status)
  values (p_cycle_id, 'APEX10.0', 'running')
  on conflict (cycle_id) do nothing;

  with signals as (
    select
      id,
      apex_tier as old_tier,
      coalesce(promotion_streak, 0) as streak,
      (permit_evidence_status in ('verified','none_found'))            as permit,
      (value_evidence_status = 'verified' or assessed_value is not null) as assessor,
      (storm_evidence_status = 'verified' or hail_inches is not null
        or wind_mph is not null or storm_date is not null)             as storm,
      (image_review_status in ('verified','adjudicated'))              as image_reviewed,
      (permit_evidence_status in ('verified','none_found')
        and permit_within_10y is true)                                 as permit_recent,
      least(100, greatest(0, coalesce(image_review_confidence, 0)))    as image_conf,
      least(100, greatest(0, coalesce(image_visibility_score, 0)))     as visibility,
      least(100, greatest(0, coalesce(image_damage_score, 0)))         as visual_damage,
      -- NOT clamped, matching fuseEvidence()'s maturitySignal: 2,463 leads
      -- currently score above 100 (max 126.10) and clamping here would flatten
      -- precisely the top of the ranking.
      coalesce(priority_score, 0)                                      as maturity
    from batch_leads
  ),
  -- fuseEvidence(): evidence quality is coverage/reliability, not lead
  -- quality. Positive signals are capped and require corroboration.
  scored as (
    select
      s.*,
      (case when s.storm then 1 else 0 end
     + case when s.image_reviewed then 1 else 0 end
     + case when s.permit_recent then 1 else 0 end) as corroboration,
      least(100, greatest(0,
          (case when s.permit   then 20 else 0 end)
        + (case when s.assessor then 20 else 0 end)
        + (case when s.storm    then 20 else 0 end)
        + (case when s.image_reviewed then 25 else 0 end)
        + (case when s.image_reviewed
                then least(15, s.image_conf * 0.10 + s.visibility * 0.05)
                else 0 end)
      )) as quality
    from signals s
  ),
  -- Clamped but NOT yet rounded: fuseEvidence() derives challengerScore from
  -- the full-precision fused value and rounds once, at the end. Rounding here
  -- instead puts challenger_score a cent off the JS path on some rows.
  fused as (
    select
      f.*,
      least(100, greatest(0,
          f.maturity * 0.55
        + (case when f.storm then 25 else 0 end)
        + (case when f.image_reviewed
                then f.visual_damage * least(1, f.image_conf / 70.0) * 0.45
                else 0 end)
        + (case when f.corroboration >= 2 then 8 else 0 end)
      )) as fusion_raw,
      least(100, greatest(0,
          f.quality * 0.65
        + (case when f.corroboration >= 2 then 20
                when f.corroboration = 1 then 10 else 0 end)
        + (case when f.image_reviewed then f.image_conf * 0.15 else 0 end)
      )) as conf_raw
    from scored f
  ),
  ranked as (
    select f.*,
           round(f.fusion_raw, 2) as fusion,
           round(f.conf_raw, 2)   as conf,
           round(f.fusion_raw * 0.75 + f.quality * 0.25, 2) as challenger,
           row_number() over (order by f.fusion_raw desc, f.quality desc, f.id) as rn
    from fused f
  ),
  decided as (
    select r.*,
           (r.rn <= p_limit and r.conf >= 70 and r.quality >= 65) as qualifies,
           case when r.rn <= p_limit and r.conf >= 70 and r.quality >= 65
                then least(r.streak + 1, p_stability_cycles) else 0 end as new_streak
    from ranked r
  ),
  final as (
    select d.*,
           case when d.qualifies and d.new_streak >= p_stability_cycles then 'top500'
                when d.conf >= 55 and d.quality >= 55 then 'top500_candidate'
                else 'watch' end as new_tier
    from decided d
  ),
  upd as (
    update batch_leads b set
      apex_rank                   = f.rn,
      promotion_streak            = f.new_streak,
      evidence_quality_score      = round(f.quality, 2),
      evidence_fusion_score       = f.fusion,
      evidence_fusion_confidence  = f.conf,
      challenger_score            = f.challenger,
      evidence_fusion_version     = 'APEX10.0',
      last_fused_at               = now(),
      apex_tier                   = f.new_tier,
      apex_decision = case
        when f.new_tier = 'top500' and coalesce(b.apex_tier,'') <> 'top500' then 'promoted'
        when coalesce(b.apex_tier,'') = 'top500' and f.new_tier <> 'top500' then 'demoted'
        else 'held' end,
      apex_decided_at             = now(),
      apex_governance_version     = 'APEX10.0'
    from final f
    where b.id = f.id
      and (b.apex_rank is distinct from f.rn
        or b.apex_tier is distinct from f.new_tier
        or b.evidence_fusion_score is distinct from f.fusion
        or b.evidence_fusion_confidence is distinct from f.conf
        or coalesce(b.promotion_streak,0) is distinct from f.new_streak)
    returning b.id, b.apex_decision
  )
  select count(*),
         count(*) filter (where apex_decision = 'promoted'),
         count(*) filter (where apex_decision = 'demoted')
    into v_changed, v_promoted, v_demoted
  from upd;

  select count(*) into v_top from batch_leads where apex_tier = 'top500';

  update twincities_apex_cycles
     set status='completed', completed_at=now(),
         scanned=v_changed, fused=v_changed, promoted=v_promoted, demoted=v_demoted,
         notes=jsonb_build_object('top500', v_top, 'stability_cycles', p_stability_cycles)
   where cycle_id = p_cycle_id;

  return jsonb_build_object('changed', v_changed, 'promoted', v_promoted,
                            'demoted', v_demoted, 'top500', v_top);
end;
$$;

revoke all on function apex10_rebuild_leaderboard(text, integer, integer) from public, anon, authenticated;
grant execute on function apex10_rebuild_leaderboard(text, integer, integer) to postgres, service_role;
