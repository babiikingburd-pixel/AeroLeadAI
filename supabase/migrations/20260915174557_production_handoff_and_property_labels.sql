-- Production handoff repair for the live AeroLeadAI rebuild.
-- 1. Persist human image annotations per property and source shot.
-- 2. Record an honest capture-date limitation for already stored static tiles.
-- 3. Retire only imagery-date crawler jobs that are now demonstrably resolved.

create table if not exists public.oversight_property_labels (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.roof_profiles(parcel_id) on delete cascade,
  shot_key text not null check (shot_key ~ '^[A-Za-z0-9._-]{1,120}$'),
  source text not null default 'unknown',
  document jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, shot_key)
);

create index if not exists oversight_property_labels_updated_idx
  on public.oversight_property_labels(updated_at desc);

alter table public.oversight_property_labels enable row level security;
revoke all on table public.oversight_property_labels from public, anon, authenticated;
grant select, insert, update, delete on table public.oversight_property_labels to service_role;

comment on table public.oversight_property_labels is
  'Owner-reviewed bounding boxes, verdicts, and notes for a specific stored imagery shot.';

-- Run the backfill in bounded batches. Each inserted evidence record refreshes
-- that property's Doctor checklist through the existing trigger, so a single
-- unbounded statement would hold one oversized transaction.
create or replace function public.normalize_static_imagery_capture_dates(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inserted integer := 0;
begin
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
    limit greatest(1, least(coalesce(p_limit, 100), 250))
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
  ),
  finished_jobs as (
    update public.oversight_crawler_jobs job
    set status = 'DONE',
        last_error = null,
        locked_at = null,
        locked_by = null,
        updated_at = now()
    from inserted
    where job.parcel_id = inserted.parcel_id
      and job.requirement = 'imagery_date'
      and job.status in ('READY', 'RETRY', 'RUNNING')
    returning job.id
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$function$;

revoke all on function public.normalize_static_imagery_capture_dates(integer) from public, anon, authenticated;
grant execute on function public.normalize_static_imagery_capture_dates(integer) to service_role;

