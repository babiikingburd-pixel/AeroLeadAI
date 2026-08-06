-- APEX 10.1 — apex10_rebuild_leaderboard() now obeys twincities_apex_controls.
--
-- Three things the 10.0 function did not do:
--
--   1. It hardcoded its thresholds (conf >= 70, quality >= 65 for top500;
--      55/55 for candidate) while twincities_apex_controls sat unread. The
--      table is now authoritative; p_limit and p_stability_cycles fall back to
--      it when the caller passes null, so /api/twincities/apex-cycle can still
--      override per request.
--   2. It ignored controls.enabled entirely — there was no way to stop the
--      engine short of revoking execute.
--   3. It ignored max_daily_promotions and never wrote a single row to
--      twincities_apex_decisions, which the 10.0 migration created for exactly
--      this purpose. Promotions are now capped per UTC day and every
--      promote/demote is logged with the numbers that caused it.
--
-- A lead blocked only by the daily cap KEEPS its promotion streak, so it is
-- first in line on the next cycle rather than starting over.
--
-- The scoring math is unchanged and still a literal transcription of
-- fuseEvidence() in lib/twincities/evidenceFusion.js. Change one, change both.

create or replace function apex10_rebuild_leaderboard(
  p_cycle_id text,
  p_limit integer default null,
  p_stability_cycles integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
-- Without this the RPC cannot complete. PostgREST connects as `authenticator`,
-- which carries statement_timeout=8s, and SET ROLE service_role does not clear
-- it (service_role has no rolconfig of its own). Ranking 152,203 rows is a
-- parallel seq scan plus a full sort — ~6s for the scan alone on a warm cache,
-- and the first run rewrites every row because apex_rank starts null. So every
-- call to this function from /api/twincities/apex-cycle aborted with 57014
-- before it wrote anything. A function-local GUC applies for the duration of
-- the call and reverts on exit.
set statement_timeout = '240s'
as $$
declare
  v_changed   integer := 0;
  v_promoted  integer := 0;
  v_demoted   integer := 0;
  v_top       integer := 0;
  v_ctl       twincities_apex_controls%rowtype;
  v_limit     integer;
  v_stability integer;
  v_min_conf  numeric;
  v_min_eq    numeric;
  v_cand_conf numeric;
  v_cand_eq   numeric;
  v_budget    integer;
  v_used      integer;
begin
  select * into v_ctl from twincities_apex_controls where id = 1;
  if not found then
    insert into twincities_apex_controls(id) values (1)
      on conflict (id) do nothing;
    select * into v_ctl from twincities_apex_controls where id = 1;
  end if;

  if v_ctl.enabled is false then
    insert into twincities_apex_cycles(cycle_id, version, status, completed_at, notes)
    values (p_cycle_id, 'APEX10.1', 'skipped', now(),
            jsonb_build_object('reason', 'twincities_apex_controls.enabled is false'))
    on conflict (cycle_id) do update
      set status='skipped', completed_at=now(),
          notes=jsonb_build_object('reason','twincities_apex_controls.enabled is false');
    return jsonb_build_object('ok', false, 'skipped', true,
                              'reason', 'governance disabled via twincities_apex_controls');
  end if;

  v_limit     := coalesce(p_limit, v_ctl.top_n, 500);
  v_stability := coalesce(p_stability_cycles, v_ctl.stability_cycles, 2);
  v_min_conf  := coalesce(v_ctl.min_confidence_for_promotion, 70);
  v_min_eq    := coalesce(v_ctl.min_evidence_quality_for_promotion, 65);
  v_cand_conf := coalesce(v_ctl.min_confidence_for_candidate, 55);
  v_cand_eq   := coalesce(v_ctl.min_evidence_quality_for_candidate, 55);

  -- Promotions already spent today, so a cycle that runs every five minutes
  -- cannot walk past the daily cap one batch at a time.
  select count(*) into v_used
    from twincities_apex_decisions
   where decision = 'promoted'
     and created_at >= date_trunc('day', now() at time zone 'utc');
  v_budget := greatest(0, coalesce(v_ctl.max_daily_promotions, 1000) - v_used);

  insert into twincities_apex_cycles(cycle_id, version, status)
  values (p_cycle_id, 'APEX10.1', 'running')
  on conflict (cycle_id) do nothing;

  create temp table _apex_cycle_result on commit drop as
  with signals as (
    select
      id,
      apex_tier as old_tier,
      apex_rank as old_rank,
      coalesce(promotion_streak, 0) as streak,
      (permit_evidence_status in ('verified','none_found'))              as permit,
      (value_evidence_status = 'verified' or assessed_value is not null) as assessor,
      (storm_evidence_status = 'verified' or hail_inches is not null
        or wind_mph is not null or storm_date is not null)               as storm,
      (image_review_status in ('verified','adjudicated'))                as image_reviewed,
      (permit_evidence_status in ('verified','none_found')
        and permit_within_10y is true)                                   as permit_recent,
      least(100, greatest(0, coalesce(image_review_confidence, 0)))      as image_conf,
      least(100, greatest(0, coalesce(image_visibility_score, 0)))       as visibility,
      least(100, greatest(0, coalesce(image_damage_score, 0)))           as visual_damage,
      coalesce(priority_score, 0)                                        as maturity
    from batch_leads
  ),
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
           (r.rn <= v_limit and r.conf >= v_min_conf and r.quality >= v_min_eq) as qualifies,
           case when r.rn <= v_limit and r.conf >= v_min_conf and r.quality >= v_min_eq
                then least(r.streak + 1, v_stability) else 0 end as new_streak
    from ranked r
  ),
  -- Rank the leads that would newly enter top500 so the daily budget goes to
  -- the strongest ones. Leads already in top500 are re-affirmations, not
  -- promotions, and are never charged against the cap.
  budgeted as (
    select d.*,
           case
             when d.qualifies and d.new_streak >= v_stability
                  and coalesce(d.old_tier,'') <> 'top500'
             then row_number() over (
                    partition by (d.qualifies and d.new_streak >= v_stability
                                  and coalesce(d.old_tier,'') <> 'top500')
                    order by d.fusion desc, d.quality desc, d.id)
             else null
           end as promotion_index
    from decided d
  ),
  final as (
    select b.*,
           (b.promotion_index is not null and b.promotion_index > v_budget) as budget_blocked,
           case
             when b.qualifies and b.new_streak >= v_stability
                  and (b.promotion_index is null or b.promotion_index <= v_budget) then 'top500'
             when b.promotion_index is not null and b.promotion_index > v_budget then 'top500_candidate'
             when b.conf >= v_cand_conf and b.quality >= v_cand_eq then 'top500_candidate'
             else 'watch'
           end as new_tier
    from budgeted b
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
        when f.budget_blocked then 'held_daily_cap'
        else 'held' end,
      apex_decision_reason = jsonb_build_object(
        'confidence', f.conf, 'evidence_quality', round(f.quality,2),
        'corroboration', f.corroboration, 'rank', f.rn,
        'streak', f.new_streak, 'required_streak', v_stability,
        'thresholds', jsonb_build_object('min_confidence', v_min_conf,
                                         'min_evidence_quality', v_min_eq),
        'budget_blocked', f.budget_blocked),
      apex_decided_at             = now(),
      apex_governance_version     = 'APEX10.1'
    from final f
    where b.id = f.id
      and (b.apex_rank is distinct from f.rn
        or b.apex_tier is distinct from f.new_tier
        or b.evidence_fusion_score is distinct from f.fusion
        or b.evidence_fusion_confidence is distinct from f.conf
        or coalesce(b.promotion_streak,0) is distinct from f.new_streak)
    returning b.id, b.apex_decision, b.apex_decision_reason,
              f.old_rank, f.rn as new_rank, f.old_tier, f.new_tier,
              f.conf, f.quality
  )
  select * from upd;

  select count(*),
         count(*) filter (where apex_decision = 'promoted'),
         count(*) filter (where apex_decision = 'demoted')
    into v_changed, v_promoted, v_demoted
  from _apex_cycle_result;

  -- Only real tier movements are logged. Logging 152K "held" rows per cycle
  -- would bury the decisions anyone actually needs to audit.
  insert into twincities_apex_decisions
    (cycle_id, lead_id, old_rank, new_rank, old_tier, new_tier,
     decision, confidence, evidence_quality, reason)
  select p_cycle_id, id, old_rank, new_rank, old_tier, new_tier,
         apex_decision, conf, round(quality, 2), apex_decision_reason
    from _apex_cycle_result
   where apex_decision in ('promoted', 'demoted', 'held_daily_cap');

  select count(*) into v_top from batch_leads where apex_tier = 'top500';

  update twincities_apex_cycles
     set status='completed', completed_at=now(),
         scanned=v_changed, fused=v_changed, promoted=v_promoted, demoted=v_demoted,
         held=(select count(*) from _apex_cycle_result where apex_decision like 'held%'),
         notes=jsonb_build_object(
           'top500', v_top,
           'stability_cycles', v_stability,
           'top_n', v_limit,
           'thresholds', jsonb_build_object('min_confidence', v_min_conf,
                                            'min_evidence_quality', v_min_eq),
           'promotion_budget', v_budget,
           'promotions_used_today', v_used)
   where cycle_id = p_cycle_id;

  return jsonb_build_object('ok', true, 'changed', v_changed, 'promoted', v_promoted,
                            'demoted', v_demoted, 'top500', v_top,
                            'promotionBudgetRemaining', greatest(0, v_budget - v_promoted));
end;
$$;

revoke all on function apex10_rebuild_leaderboard(text, integer, integer) from public, anon, authenticated;
grant execute on function apex10_rebuild_leaderboard(text, integer, integer) to postgres, service_role;
