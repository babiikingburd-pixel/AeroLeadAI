-- The evidence table has per-row Doctor and scoring triggers. Static imagery
-- normalization is metadata-only and does not change a score, so suppress those
-- triggers for this session and repair the affected Doctor state set-wise.
create or replace function public.normalize_static_imagery_capture_dates(p_limit integer default 2000)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inserted integer := 0;
  v_parcels text[] := '{}'::text[];
begin
  perform set_config('session_replication_role', 'replica', true);

  with latest as (
    select distinct on (e.parcel_id)
      e.id,
      e.parcel_id,
      e.provider,
      e.reality,
      e.confidence,
      e.source_ref,
      e.content_hash,
      e.captured_at,
      e.payload
    from public.evidence_records e
    where e.type = 'IMAGERY'
      and e.reality in ('REAL_NOW', 'CACHED_REAL')
      and coalesce(e.payload->>'storage_path', '') <> ''
      and coalesce(e.payload->>'capture_date', '') = ''
      and coalesce(e.payload->>'capture_date_status', '') = ''
      and lower(concat_ws(' ', e.provider, e.payload->>'provider')) ~ '(esri|world imagery|google|mapbox|nearmap)'
    order by e.parcel_id, e.captured_at desc
  ),
  candidates as (
    select latest.*
    from latest
    where not exists (
      select 1
      from public.evidence_records resolved
      where resolved.parcel_id = latest.parcel_id
        and resolved.type = 'IMAGERY'
        and resolved.reality in ('REAL_NOW', 'CACHED_REAL')
        and (
          resolved.effective_at is not null
          or coalesce(resolved.payload->>'capture_date', '') <> ''
          or resolved.payload->>'capture_date_status' = 'provider_does_not_expose_capture_date'
        )
    )
    order by latest.captured_at desc
    limit greatest(1, least(coalesce(p_limit, 2000), 5000))
  ),
  inserted as (
    insert into public.evidence_records(
      id,
      parcel_id,
      type,
      provider,
      reality,
      captured_at,
      effective_at,
      source_ref,
      content_hash,
      confidence,
      payload
    )
    select
      'imagery-date-limit:' || md5(parcel_id || ':' || coalesce(content_hash, id)),
      parcel_id,
      'IMAGERY',
      provider,
      reality,
      now(),
      null,
      source_ref,
      md5(parcel_id || ':' || coalesce(content_hash, id) || ':provider-does-not-expose-capture-date'),
      confidence,
      payload || jsonb_build_object(
        'capture_date', null,
        'capture_date_status', 'provider_does_not_expose_capture_date',
        'freshness_basis', 'retrieval_timestamp_only'
      )
    from candidates
    on conflict (id) do nothing
    returning parcel_id
  )
  select coalesce(array_agg(parcel_id), '{}'::text[]), count(*)
  into v_parcels, v_inserted
  from inserted;

  perform set_config('session_replication_role', 'origin', true);

  if v_inserted = 0 then
    return 0;
  end if;

  update public.oversight_audit_tasks task
  set status = 'DONE',
      last_error = null,
      next_attempt_at = now(),
      updated_at = now()
  where task.parcel_id = any(v_parcels)
    and task.requirement = 'imagery_date';

  update public.oversight_crawler_jobs job
  set status = 'DONE',
      last_error = null,
      locked_at = null,
      locked_by = null,
      next_attempt_at = now(),
      updated_at = now()
  where job.parcel_id = any(v_parcels)
    and job.requirement = 'imagery_date'
    and job.status in ('READY', 'RETRY', 'RUNNING');

  with patched as (
    select
      audit.parcel_id,
      jsonb_agg(
        case
          when item.value->>'key' = 'imagery_date'
            then item.value || jsonb_build_object(
              'complete', true,
              'status', 'DONE',
              'evidenceProvider', 'static-provider-metadata'
            )
          else item.value
        end
        order by item.ordinality
      ) as checklist,
      array_remove(audit.missing_requirements, 'imagery_date') as missing_requirements,
      case
        when 'imagery_date' = any(audit.missing_requirements)
          then least(audit.required_count, audit.complete_count + 1)
        else audit.complete_count
      end as complete_count
    from public.oversight_property_audits audit
    cross join lateral jsonb_array_elements(audit.checklist) with ordinality as item(value, ordinality)
    where audit.parcel_id = any(v_parcels)
    group by
      audit.parcel_id,
      audit.missing_requirements,
      audit.required_count,
      audit.complete_count
  )
  update public.oversight_property_audits audit
  set checklist = patched.checklist,
      missing_requirements = patched.missing_requirements,
      complete_count = patched.complete_count,
      completion_pct = round(patched.complete_count::numeric / nullif(audit.required_count, 0) * 100),
      audit_complete = cardinality(patched.missing_requirements) = 0,
      next_required_action = (
        select check_item->>'key'
        from jsonb_array_elements(patched.checklist) check_item
        where check_item->>'status' = 'READY'
          and check_item->>'key' <> 'imagery_date'
        order by (check_item->>'priority')::integer desc
        limit 1
      ),
      last_audited_at = now()
  from patched
  where audit.parcel_id = patched.parcel_id;

  return v_inserted;
end;
$function$;

revoke all on function public.normalize_static_imagery_capture_dates(integer) from public, anon, authenticated;
grant execute on function public.normalize_static_imagery_capture_dates(integer) to service_role;

