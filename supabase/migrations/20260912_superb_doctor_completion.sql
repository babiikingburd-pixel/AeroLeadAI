-- AeroLeadAI Superb: a static imagery provider that explicitly reports it
-- does not expose a per-image capture date is a resolved evidence limitation,
-- not an infinite repair loop. We never fabricate a date; the payload keeps
-- capture_date null and records retrieval timestamp as the only freshness basis.
create or replace function public.refresh_oversight_doctor(p_parcel_id text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profile public.roof_profiles%rowtype;
  v_structure jsonb := '{}'::jsonb;
  v_structure_provider text;
  v_imagery jsonb := '{}'::jsonb;
  v_imagery_provider text;
  v_imagery_effective_at timestamptz;
  v_permit_provider text;
  v_weather_provider text;
  v_identity boolean;
  v_geolocation boolean;
  v_classification boolean;
  v_year_built boolean;
  v_imagery_capture boolean;
  v_imagery_date boolean;
  v_imagery_analysis boolean;
  v_permit boolean;
  v_weather boolean;
  v_checklist jsonb;
  v_missing text[];
  v_complete_count integer;
  v_next text;
begin
  select * into v_profile from public.roof_profiles where parcel_id = p_parcel_id;
  if not found then return; end if;

  select payload, provider into v_structure, v_structure_provider
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'STRUCTURE' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  select payload, provider, effective_at into v_imagery, v_imagery_provider, v_imagery_effective_at
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'IMAGERY' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  select provider into v_permit_provider
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'PERMIT' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  select provider into v_weather_provider
  from public.evidence_records
  where parcel_id = p_parcel_id and type = 'WEATHER' and reality in ('REAL_NOW','CACHED_REAL')
  order by captured_at desc limit 1;

  v_identity := nullif(btrim(v_profile.parcel_id), '') is not null
    and nullif(btrim(v_profile.address), '') is not null
    and nullif(btrim(coalesce(v_profile.zip, '')), '') is not null;
  v_geolocation := (v_structure->>'latitude') is not null and (v_structure->>'longitude') is not null;
  v_classification := coalesce(v_structure->>'property_type', v_structure->>'dwelling_type', v_structure->>'use_type', '') <> '';
  v_year_built := coalesce(v_structure->>'year_built', v_structure->>'yearBuilt', v_structure->>'effective_year_built', '') ~ '^[0-9]{4}$';
  v_imagery_capture := coalesce(v_imagery->>'storage_path', '') <> '';
  v_imagery_date := coalesce(v_imagery->>'capture_date', '') <> ''
    or v_imagery_effective_at is not null
    or lower(coalesce(v_imagery->>'capture_date_status', '')) = 'provider_does_not_expose_capture_date';
  v_imagery_analysis := lower(coalesce(v_imagery->>'damage_analysis_status', v_imagery->>'analysis_status', '')) in ('complete','completed','analyzed','reviewed');
  v_permit := v_permit_provider is not null;
  v_weather := v_weather_provider is not null;

  v_checklist := jsonb_build_array(
    jsonb_build_object('key','identity','label','Property identity','complete',v_identity,'status',case when v_identity then 'DONE' else 'READY' end,'priority',100,'provider','property registry','repairAction','Resolve the parcel ID, street address and ZIP.'),
    jsonb_build_object('key','geolocation','label','Verified coordinates','complete',v_geolocation,'status',case when v_geolocation then 'DONE' else 'READY' end,'priority',98,'provider','county/Census geocoder','repairAction','Resolve and persist parcel latitude and longitude.','evidenceProvider',v_structure_provider),
    jsonb_build_object('key','property_classification','label','Property classification','complete',v_classification,'status',case when v_classification then 'DONE' else 'READY' end,'priority',94,'provider','county assessor','repairAction','Confirm residential/commercial class and dwelling type.','evidenceProvider',v_structure_provider),
    jsonb_build_object('key','year_built','label','Year built','complete',v_year_built,'status',case when v_year_built then 'DONE' else 'READY' end,'priority',92,'provider','county assessor','repairAction','Retrieve the public construction year.','evidenceProvider',v_structure_provider),
    jsonb_build_object('key','imagery_capture','label','Property imagery','complete',v_imagery_capture,'status',case when v_imagery_capture then 'DONE' when v_geolocation then 'READY' else 'WAITING_DEPENDENCY' end,'priority',90,'provider','imagery provider','repairAction','Fetch and privately store a real property image.','evidenceProvider',v_imagery_provider),
    jsonb_build_object('key','imagery_date','label','Imagery freshness','complete',v_imagery_date,'status',case when v_imagery_date then 'DONE' when v_imagery_capture then 'READY' else 'WAITING_DEPENDENCY' end,'priority',86,'provider','imagery metadata','repairAction','Retrieve the provider capture date or explicitly record that the provider does not expose one.','evidenceProvider',v_imagery_provider),
    jsonb_build_object('key','imagery_analysis','label','Roof imagery analysis','complete',v_imagery_analysis,'status',case when v_imagery_analysis then 'DONE' when v_imagery_capture then 'READY' else 'WAITING_DEPENDENCY' end,'priority',84,'provider','vision review','repairAction','Analyze the stored roof image and persist possible visual concerns with confidence.','evidenceProvider',v_imagery_provider),
    jsonb_build_object('key','permit_history','label','Roof permit search','complete',v_permit,'status',case when v_permit then 'DONE' else 'READY' end,'priority',82,'provider','permit provider','repairAction','Search the full permit window and record matches or a verified no-match.','evidenceProvider',v_permit_provider),
    jsonb_build_object('key','weather_history','label','Storm history search','complete',v_weather,'status',case when v_weather then 'DONE' when v_geolocation then 'READY' else 'WAITING_DEPENDENCY' end,'priority',80,'provider','NOAA/NWS','repairAction','Search hail and wind history and record matches or a bounded verified search result.','evidenceProvider',v_weather_provider)
  );

  select coalesce(array_agg(item->>'key' order by (item->>'priority')::integer desc), '{}'::text[])
  into v_missing from jsonb_array_elements(v_checklist) item where not (item->>'complete')::boolean;
  v_complete_count := 9 - cardinality(v_missing);
  select item->>'key' into v_next from jsonb_array_elements(v_checklist) item
    where item->>'status' = 'READY' order by (item->>'priority')::integer desc limit 1;

  insert into public.oversight_property_audits(parcel_id, checklist, complete_count, required_count, completion_pct, audit_complete, missing_requirements, next_required_action, last_audited_at)
  values (p_parcel_id, v_checklist, v_complete_count, 9, round(v_complete_count::numeric / 9 * 100), cardinality(v_missing) = 0, v_missing, v_next, now())
  on conflict (parcel_id) do update set checklist=excluded.checklist, complete_count=excluded.complete_count, required_count=excluded.required_count,
    completion_pct=excluded.completion_pct, audit_complete=excluded.audit_complete, missing_requirements=excluded.missing_requirements,
    next_required_action=excluded.next_required_action, last_audited_at=excluded.last_audited_at;

  insert into public.oversight_audit_tasks(parcel_id, requirement, status, priority, provider, repair_action, next_attempt_at, updated_at)
  select p_parcel_id, item->>'key', item->>'status', (item->>'priority')::integer, item->>'provider', item->>'repairAction', now(), now()
  from jsonb_array_elements(v_checklist) item
  on conflict (parcel_id, requirement) do update set status=excluded.status, priority=excluded.priority, provider=excluded.provider,
    repair_action=excluded.repair_action, updated_at=excluded.updated_at,
    last_error=case when excluded.status='DONE' then null else public.oversight_audit_tasks.last_error end;
end;
$function$;
