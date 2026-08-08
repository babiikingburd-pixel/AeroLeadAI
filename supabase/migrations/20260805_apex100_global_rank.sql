-- APEX 10.0 server-side global ranking. This avoids scanning 152K rows through a Next.js request.
create or replace function apex10_rebuild_leaderboard(
  p_cycle_id text,
  p_limit integer default 500
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_scanned integer := 0;
  v_top integer := 0;
begin
  with ranked as (
    select id,
      row_number() over (
        order by
          (
            least(100, greatest(0,
              coalesce(priority_score,0) * 0.55
              + case when storm_evidence_status='verified'
                       or hail_inches is not null or wind_mph is not null or storm_date is not null
                     then 25 else 0 end
              + case when image_review_status in ('verified','adjudicated')
                     then least(45, coalesce(image_damage_score,0) * least(1,coalesce(image_review_confidence,0)/70.0) * .45)
                     else 0 end
              + case when
                  (case when permit_evidence_status in ('verified','none_found') then 1 else 0 end
                   + case when value_evidence_status='verified' or assessed_value is not null then 1 else 0 end
                   + case when storm_evidence_status='verified' or hail_inches is not null or wind_mph is not null or storm_date is not null then 1 else 0 end
                   + case when image_review_status in ('verified','adjudicated') then 1 else 0 end) >= 2
                 then 8 else 0 end
            )))
          ) desc,
          priority_score desc nulls last,
          id
      ) as rn,
      least(100, greatest(0,
        (case when permit_evidence_status in ('verified','none_found') then 20 else 0 end)
        +(case when value_evidence_status='verified' or assessed_value is not null then 20 else 0 end)
        +(case when storm_evidence_status='verified' or hail_inches is not null or wind_mph is not null or storm_date is not null then 20 else 0 end)
        +(case when image_review_status in ('verified','adjudicated') then 25 else 0 end)
        +(case when image_review_status in ('verified','adjudicated')
                then least(15,coalesce(image_review_confidence,0)*.10+coalesce(image_visibility_score,0)*.05)
               else 0 end)
      )) as eq,
      least(100, greatest(0,
        (case when permit_evidence_status in ('verified','none_found') then 20 else 0 end
         +case when value_evidence_status='verified' or assessed_value is not null then 20 else 0 end
         +case when storm_evidence_status='verified' or hail_inches is not null or wind_mph is not null or storm_date is not null then 20 else 0 end
         +case when image_review_status in ('verified','adjudicated') then 25 else 0 end)
        *.65
        +(case when image_review_status in ('verified','adjudicated') then coalesce(image_review_confidence,0)*.15 else 0 end)
      )) as conf
    from batch_leads
  ),
  upd as (
    update batch_leads b set
      apex_rank=r.rn,
      evidence_quality_score=r.eq,
      evidence_fusion_score=least(100,greatest(0,
        coalesce(b.priority_score,0)*.55
        +case when b.storm_evidence_status='verified' or b.hail_inches is not null or b.wind_mph is not null or b.storm_date is not null then 25 else 0 end
        +case when b.image_review_status in ('verified','adjudicated')
              then least(45,coalesce(b.image_damage_score,0)*least(1,coalesce(b.image_review_confidence,0)/70.0)*.45)
              else 0 end
      )),
      evidence_fusion_confidence=r.conf,
      evidence_fusion_version='APEX10.0',
      last_fused_at=now(),
      apex_tier=case
        when r.rn <= p_limit and r.conf >= 70 and r.eq >= 65 then 'top500'
        when r.conf >= 55 and r.eq >= 55 then 'top500_candidate'
        else 'watch'
      end,
      apex_decision=case
        when r.rn <= p_limit and r.conf >= 70 and r.eq >= 65 and coalesce(b.apex_tier,'') <> 'top500' then 'promoted'
        when coalesce(b.apex_tier,'')='top500' and not(r.rn <= p_limit and r.conf >= 70 and r.eq >= 65) then 'demoted'
        else 'held'
      end,
      apex_decided_at=now(),
      apex_governance_version='APEX10.0'
    from ranked r where b.id=r.id
    returning b.id, b.apex_rank
  )
  select count(*) into v_scanned from upd;
  select count(*) into v_top from batch_leads where apex_rank <= p_limit and apex_tier='top500';

  insert into twincities_apex_cycles(cycle_id,version,status,completed_at,scanned,fused,notes)
  values(p_cycle_id,'APEX10.0','completed',now(),v_scanned,v_scanned,jsonb_build_object('top500',v_top));

  return jsonb_build_object('scanned',v_scanned,'top500',v_top);
end;
$$;
