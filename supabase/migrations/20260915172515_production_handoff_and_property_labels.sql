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

with latest_static_imagery as (
  select distinct on (parcel_id)
    id,
    parcel_id,
    provider,
    reality,
    confidence,
    source_ref,
    content_hash,
    captured_at,
    payload
  from public.evidence_records
  where type = 'IMAGERY'
    and reality in ('REAL_NOW', 'CACHED_REAL')
    and coalesce(payload->>'storage_path', '') <> ''
    and coalesce(payload->>'capture_date', '') = ''
    and coalesce(payload->>'capture_date_status', '') = ''
    and lower(concat_ws(' ', provider, payload->>'provider')) ~ '(esri|world imagery|google|mapbox|nearmap)'
  order by parcel_id, captured_at desc
)
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
from latest_static_imagery
on conflict (id) do update
set captured_at = excluded.captured_at,
    payload = excluded.payload,
    confidence = excluded.confidence;

update public.oversight_crawler_jobs job
set status = 'DONE',
    last_error = null,
    locked_at = null,
    locked_by = null,
    updated_at = now()
where job.requirement = 'imagery_date'
  and job.status in ('READY', 'RETRY', 'RUNNING')
  and exists (
    select 1
    from public.evidence_records evidence
    where evidence.parcel_id = job.parcel_id
      and evidence.type = 'IMAGERY'
      and evidence.reality in ('REAL_NOW', 'CACHED_REAL')
      and (
        evidence.effective_at is not null
        or coalesce(evidence.payload->>'capture_date', '') <> ''
        or evidence.payload->>'capture_date_status' = 'provider_does_not_expose_capture_date'
      )
  );
