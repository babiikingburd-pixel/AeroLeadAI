-- AeroLeadAI Superb evidence fusion.
-- Replaces flat placeholder-like opportunity ties only after a real visual
-- analysis exists. Visual condition dominates; permits, storm evidence, and
-- property age are corroborating signals. Property age is intentionally weak
-- because it is not the same thing as roof age.

create or replace function public.refresh_superb_opportunity(p_parcel_id text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_img jsonb := '{}'::jsonb;
  v_permit jsonb := '{}'::jsonb;
  v_weather jsonb := '{}'::jsonb;
  v_structure jsonb := '{}'::jsonb;
  v_img_conf numeric := 0;
  v_permit_conf numeric := 0;
  v_weather_conf numeric := 0;
  v_structure_conf numeric := 0;
  v_visual numeric := 0;
  v_permit_score numeric := 40;
  v_weather_score numeric := 30;
  v_age_score numeric := 25;
  v_bonus numeric := 0;
  v_score numeric := 0;
  v_conf numeric := 0;
  v_recent_permit date;
  v_year_built integer;
  v_event_count integer := 0;
  v_record_count integer := 0;
  v_analysis_status text;
begin
  select payload, confidence into v_img, v_img_conf
  from public.evidence_records
  where parcel_id = p_parcel_id
    and type = 'IMAGERY'
    and reality in ('REAL_NOW','CACHED_REAL')
    and (
      payload ? 'possible_concern_score'
      or lower(coalesce(payload->>'damage_analysis_status', payload->>'analysis_status', '')) in ('complete','completed','analyzed','reviewed')
    )
  order by captured_at desc
  limit 1;

  if not found then
    return;
  end if;

  v_analysis_status := lower(coalesce(v_img->>'damage_analysis_status', v_img->>'analysis_status', ''));
  if v_analysis_status not in ('complete','completed','analyzed','reviewed') and not (v_img ? 'possible_concern_score') then
    return;
  end if;

  if coalesce(v_img->>'possible_concern_score','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_visual := greatest(0, least(100, (v_img->>'possible_concern_score')::numeric));
  end if;

  select payload, confidence into v_permit, v_permit_conf
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'PERMIT' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  select payload, confidence into v_weather, v_weather_conf
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'WEATHER' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  select payload, confidence into v_structure, v_structure_conf
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'STRUCTURE' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  -- Permit signal: a recent roofing permit strongly reduces opportunity.
  -- A verified no-match is only a moderate positive signal, never proof of age.
  if coalesce(v_permit->>'search_result','') = 'no_matching_roofing_permits' then
    v_permit_score := 60;
  else
    if jsonb_typeof(v_permit->'records') = 'array' then
      v_record_count := jsonb_array_length(v_permit->'records');
      select max(substring(d from 1 for 10)::date) into v_recent_permit
      from (
        select coalesce(item->>'issue_date', item->>'permit_date', item->>'file_date', item->>'date') as d
        from jsonb_array_elements(v_permit->'records') item
      ) q
      where d ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}';
    elsif coalesce(v_permit->>'record_count','') ~ '^[0-9]+$' then
      v_record_count := (v_permit->>'record_count')::integer;
    end if;

    if v_recent_permit is not null then
      if v_recent_permit >= current_date - interval '7 years' then v_permit_score := 8;
      elsif v_recent_permit >= current_date - interval '15 years' then v_permit_score := 35;
      else v_permit_score := 62;
      end if;
    elsif v_record_count > 0 then
      v_permit_score := 45;
    end if;
  end if;

  -- Storm signal is corroboration only. SWDI hits can be radar-derived probable
  -- conditions; a no-hit result is not proof that no storm occurred.
  if coalesce(v_weather->>'event_count','') ~ '^[0-9]+$' then
    v_event_count := (v_weather->>'event_count')::integer;
  elsif jsonb_typeof(v_weather->'events') = 'array' then
    v_event_count := jsonb_array_length(v_weather->'events');
  end if;
  if v_event_count > 0 then
    v_weather_score := least(85, 55 + least(30, v_event_count));
  else
    v_weather_score := 30;
  end if;

  -- Weak property-age signal, explicitly not roof age.
  if coalesce(v_structure->>'year_built', v_structure->>'yearBuilt', v_structure->>'effective_year_built', '') ~ '^[0-9]{4}$' then
    v_year_built := coalesce(v_structure->>'year_built', v_structure->>'yearBuilt', v_structure->>'effective_year_built')::integer;
    if v_year_built <= extract(year from current_date)::integer - 40 then v_age_score := 70;
    elsif v_year_built <= extract(year from current_date)::integer - 30 then v_age_score := 55;
    elsif v_year_built <= extract(year from current_date)::integer - 20 then v_age_score := 40;
    else v_age_score := 20;
    end if;
  end if;

  if v_visual >= 45 and v_permit_score >= 55 then v_bonus := v_bonus + 5; end if;
  if v_visual >= 45 and v_weather_score >= 55 then v_bonus := v_bonus + 5; end if;

  v_score := round(greatest(0, least(100,
      v_visual * 0.60
    + v_permit_score * 0.18
    + v_weather_score * 0.12
    + v_age_score * 0.10
    + v_bonus
  )), 2);

  v_conf := round(greatest(0.30, least(0.98,
      coalesce(v_img_conf,0) * 0.55
    + coalesce(nullif(v_permit_conf,0),0.40) * 0.15
    + coalesce(nullif(v_weather_conf,0),0.40) * 0.15
    + coalesce(nullif(v_structure_conf,0),0.50) * 0.15
  )), 3);

  update public.roof_profiles
  set opportunity = v_score,
      commercial_priority = v_score,
      evidence_confidence = v_conf,
      updated_at = now()
  where parcel_id = p_parcel_id;
end;
$function$;

create or replace function public.refresh_superb_opportunity_from_evidence()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.refresh_superb_opportunity(coalesce(new.parcel_id, old.parcel_id));
  return coalesce(new, old);
end;
$function$;

drop trigger if exists oversight_superb_score_evidence_trigger on public.evidence_records;
create trigger oversight_superb_score_evidence_trigger
after insert or update or delete on public.evidence_records
for each row execute function public.refresh_superb_opportunity_from_evidence();
