-- Start each daily Evidence Twin pass from a bounded current snapshot.
-- Without this boundary, a property that becomes ineligible could retain an
-- old score row and stay in a Top-500 slot indefinitely.

create or replace function public.lite_begin_score_refresh(p_score_version text)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  removed integer := 0;
begin
  if coalesce(trim(p_score_version), '') = '' then
    raise exception 'p_score_version is required';
  end if;

  delete from public.aerolead_property_scores;
  get diagnostics removed = row_count;

  update public.batch_leads
     set lite_rank = null,
         lite_tier = null,
         lite_rank_score = 0,
         lite_contractor_value_score = 0,
         lite_score_status = 'PROVISIONAL',
         lite_classification = 'HOLD-FOR-VERIFICATION',
         lite_selection_track = null,
         lite_score_version = p_score_version,
         lite_score_breakdown = '{}'::jsonb,
         lite_scored_at = null,
         top500_slot = null,
         top500_slot_state = 'none',
         top500_evidence_version = p_score_version
   where lite_score_version is not null
      or top500_slot is not null;

  return removed;
end;
$$;

revoke all on function public.lite_begin_score_refresh(text) from public, anon, authenticated;
grant execute on function public.lite_begin_score_refresh(text) to service_role;
