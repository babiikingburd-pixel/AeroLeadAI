-- AeroLeadAI Lite Evidence Twin 1.0
--
-- Consolidates the strongest V23 GateKeeper ideas into the Minnesota roofing
-- pipeline while keeping the database compact and owner-only:
--   * current-only versioned score rows (no unbounded score history)
--   * metadata-only imagery manifests, capped by the application at 3 snapshots
--   * private object storage; no base64 image bytes in Postgres
--   * no anon/authenticated access to AeroLeadAI business tables/functions

alter table if exists public.batch_leads
  add column if not exists opportunity_score numeric default 0,
  add column if not exists evidence_confidence numeric default 0,
  add column if not exists top500_slot integer,
  add column if not exists top500_slot_state text default 'none',
  add column if not exists top500_evidence_version text,
  add column if not exists lite_rank integer,
  add column if not exists lite_tier text,
  add column if not exists lite_rank_score numeric default 0,
  add column if not exists lite_contractor_value_score numeric default 0,
  add column if not exists lite_score_status text default 'PROVISIONAL',
  add column if not exists lite_classification text default 'HOLD-FOR-VERIFICATION',
  add column if not exists lite_selection_track text,
  add column if not exists lite_score_version text,
  add column if not exists lite_score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists lite_scored_at timestamptz;

create index if not exists idx_batch_leads_lite_rank
  on public.batch_leads(lite_rank_score desc, evidence_confidence desc)
  where coalesce(review_status, '') <> 'rejected';

alter table if exists public.property_images
  add column if not exists view text not null default 'center',
  add column if not exists storage_path text,
  add column if not exists image_kind text not null default 'property_overview',
  add column if not exists quality_score numeric,
  add column if not exists evidence_status text not null default 'fetched',
  add column if not exists capture_date timestamptz,
  add column if not exists content_hash text,
  add column if not exists byte_size bigint,
  add column if not exists mime_type text,
  add column if not exists last_verified_at timestamptz,
  add column if not exists is_current boolean not null default true;

-- property_images is the current manifest, not history. Preserve the newest
-- metadata row for each property/view; dated snapshots live in the compact
-- imagery_manifest_history table below.
with ranked as (
  select id,
         row_number() over (
           partition by property_id, coalesce(view, 'center')
           order by fetched_at desc nulls last, id desc
         ) as rn
    from public.property_images
)
delete from public.property_images p
 using ranked r
 where p.id = r.id and r.rn > 1;

create unique index if not exists ux_property_images_property_view
  on public.property_images(property_id, view);

create table if not exists public.imagery_manifests (
  cache_key text primary key,
  property_id text references public.batch_leads(id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  provider text,
  storage_paths jsonb not null default '{}'::jsonb,
  content_hashes jsonb not null default '{}'::jsonb,
  byte_sizes jsonb not null default '{}'::jsonb,
  mime_types jsonb not null default '{}'::jsonb,
  resolution jsonb not null default '{}'::jsonb,
  sweep jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_imagery_manifests_property
  on public.imagery_manifests(property_id, fetched_at desc);

create table if not exists public.imagery_manifest_history (
  id bigserial primary key,
  cache_key text not null,
  property_id text references public.batch_leads(id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  provider text,
  storage_paths jsonb not null default '{}'::jsonb,
  content_hashes jsonb not null default '{}'::jsonb,
  byte_sizes jsonb not null default '{}'::jsonb,
  mime_types jsonb not null default '{}'::jsonb,
  resolution jsonb not null default '{}'::jsonb,
  sweep jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_imagery_manifest_history_key
  on public.imagery_manifest_history(cache_key, fetched_at desc);

create table if not exists public.aerolead_evidence_observations (
  id bigserial primary key,
  property_id text not null references public.batch_leads(id) on delete cascade,
  claim_key text not null,
  source text not null,
  source_ref text,
  polarity text not null check (polarity in ('positive', 'negative', 'neutral')),
  verified boolean not null default false,
  confidence numeric not null default 0 check (confidence between 0 and 100),
  value jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  expires_at timestamptz,
  reproducible_key text,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_observations_property
  on public.aerolead_evidence_observations(property_id, observed_at desc);
create index if not exists idx_evidence_observations_expiry
  on public.aerolead_evidence_observations(expires_at)
  where expires_at is not null;

create table if not exists public.aerolead_property_scores (
  property_id text primary key references public.batch_leads(id) on delete cascade,
  score_version text not null,
  lite_rank integer,
  lite_tier text,
  selection_track text,
  opportunity_score numeric not null default 0,
  evidence_confidence numeric not null default 0,
  contractor_value_score numeric not null default 0,
  rank_score numeric not null default 0,
  score_status text not null default 'PROVISIONAL',
  classification text not null default 'HOLD-FOR-VERIFICATION',
  evidence_summary jsonb not null default '{}'::jsonb,
  score_breakdown jsonb not null default '{}'::jsonb,
  penalties jsonb not null default '[]'::jsonb,
  next_evidence_plan jsonb not null default '[]'::jsonb,
  scored_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_aerolead_property_scores_rank
  on public.aerolead_property_scores(rank_score desc, evidence_confidence desc);
create index if not exists idx_aerolead_property_scores_tier
  on public.aerolead_property_scores(lite_tier, lite_rank);

-- Apply a bounded score batch atomically. This keeps one current row per
-- property and mirrors only the fields needed by the existing interfaces.
create or replace function public.lite_apply_scores(p_scores jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  applied integer := 0;
begin
  if jsonb_typeof(p_scores) <> 'array' then
    raise exception 'p_scores must be a JSON array';
  end if;

  with incoming as (
    select *
      from jsonb_to_recordset(p_scores) as score(
        property_id text,
        score_version text,
        lite_rank integer,
        lite_tier text,
        selection_track text,
        opportunity_score numeric,
        evidence_confidence numeric,
        contractor_value_score numeric,
        rank_score numeric,
        score_status text,
        classification text,
        evidence_summary jsonb,
        score_breakdown jsonb,
        penalties jsonb,
        next_evidence_plan jsonb,
        scored_at timestamptz
      )
  )
  insert into public.aerolead_property_scores(
    property_id, score_version, lite_rank, lite_tier, selection_track,
    opportunity_score, evidence_confidence, contractor_value_score, rank_score,
    score_status, classification, evidence_summary, score_breakdown, penalties,
    next_evidence_plan, scored_at, updated_at
  )
  select property_id, score_version, lite_rank, lite_tier, selection_track,
         opportunity_score, evidence_confidence, contractor_value_score, rank_score,
         score_status, classification, coalesce(evidence_summary, '{}'::jsonb),
         coalesce(score_breakdown, '{}'::jsonb), coalesce(penalties, '[]'::jsonb),
         coalesce(next_evidence_plan, '[]'::jsonb), coalesce(scored_at, now()), now()
    from incoming
   where property_id is not null
  on conflict(property_id) do update set
    score_version = excluded.score_version,
    lite_rank = excluded.lite_rank,
    lite_tier = excluded.lite_tier,
    selection_track = excluded.selection_track,
    opportunity_score = excluded.opportunity_score,
    evidence_confidence = excluded.evidence_confidence,
    contractor_value_score = excluded.contractor_value_score,
    rank_score = excluded.rank_score,
    score_status = excluded.score_status,
    classification = excluded.classification,
    evidence_summary = excluded.evidence_summary,
    score_breakdown = excluded.score_breakdown,
    penalties = excluded.penalties,
    next_evidence_plan = excluded.next_evidence_plan,
    scored_at = excluded.scored_at,
    updated_at = now();

  get diagnostics applied = row_count;

  with incoming as (
    select *
      from jsonb_to_recordset(p_scores) as score(
        property_id text,
        score_version text,
        lite_rank integer,
        lite_tier text,
        selection_track text,
        opportunity_score numeric,
        evidence_confidence numeric,
        contractor_value_score numeric,
        rank_score numeric,
        score_status text,
        classification text,
        evidence_summary jsonb,
        score_breakdown jsonb,
        penalties jsonb,
        next_evidence_plan jsonb,
        scored_at timestamptz
      )
  )
  update public.batch_leads lead
     set lite_rank = score.lite_rank,
         lite_tier = score.lite_tier,
         opportunity_score = score.opportunity_score,
         evidence_confidence = score.evidence_confidence,
         lite_contractor_value_score = score.contractor_value_score,
         lite_rank_score = score.rank_score,
         lite_score_status = score.score_status,
         lite_classification = score.classification,
         lite_selection_track = score.selection_track,
         lite_score_version = score.score_version,
         lite_score_breakdown = coalesce(score.score_breakdown, '{}'::jsonb),
         lite_scored_at = coalesce(score.scored_at, now())
    from incoming score
   where lead.id = score.property_id;

  return applied;
end;
$$;

-- Synchronize the persistent 500 slots from the versioned score table. Slot
-- incumbents are replaced only by the current deterministic ranking; crawler
-- task generation remains delegated to ensure_top500_crawler_tasks().
create or replace function public.lite_sync_top500_slots()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  occupied integer := 0;
  generated integer := 0;
begin
  insert into public.top500_slots(slot_no, status, created_at, updated_at)
  select slot_no, 'open', now(), now()
    from generate_series(1, 500) slot_no
  on conflict(slot_no) do nothing;

  with ranked as (
    select property_id, lite_rank, rank_score, evidence_confidence
      from public.aerolead_property_scores
     where lite_rank between 1 and 500
     order by lite_rank
  )
  update public.top500_slots slot
     set property_id = ranked.property_id,
         rank = ranked.lite_rank,
         score = ranked.rank_score,
         evidence_confidence = ranked.evidence_confidence,
         status = 'occupied',
         assigned_at = case when slot.property_id is distinct from ranked.property_id then now() else slot.assigned_at end,
         replacement_count = coalesce(slot.replacement_count, 0) + case when slot.property_id is not null and slot.property_id is distinct from ranked.property_id then 1 else 0 end,
         updated_at = now()
    from ranked
   where slot.slot_no = ranked.lite_rank;

  update public.top500_slots slot
     set property_id = null,
         rank = null,
         score = 0,
         evidence_confidence = 0,
         status = 'open',
         updated_at = now()
   where not exists (
     select 1 from public.aerolead_property_scores score
      where score.lite_rank = slot.slot_no and score.lite_rank between 1 and 500
   );

  update public.batch_leads lead
     set top500_slot = case when score.lite_rank <= 500 then score.lite_rank else null end,
         top500_slot_state = case when score.lite_rank <= 500 then 'active' else 'none' end,
         top500_evidence_version = score.score_version
    from public.aerolead_property_scores score
   where lead.id = score.property_id;

  select count(*) into occupied from public.top500_slots where status = 'occupied';
  if to_regprocedure('public.ensure_top500_crawler_tasks()') is not null then
    execute 'select public.ensure_top500_crawler_tasks()' into generated;
  end if;
  return jsonb_build_object('occupied', occupied, 'tasks_generated', generated);
end;
$$;

-- Private bucket: signed URLs are minted only by owner-authenticated server
-- routes. Existing public URLs stop working once this flag is false.
insert into storage.buckets(id, name, public)
values ('property-images', 'property-images', false)
on conflict(id) do update set public = false;

-- Owner-only data plane. RLS is defense in depth; grants remove object reach
-- from anon/authenticated before a policy is even considered.
alter table public.imagery_manifests enable row level security;
alter table public.imagery_manifest_history enable row level security;
alter table public.aerolead_evidence_observations enable row level security;
alter table public.aerolead_property_scores enable row level security;
alter table public.property_images enable row level security;

do $$
declare
  item record;
begin
  for item in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;

  for item in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and (
         coalesce(qual, '') ilike '%property-images%'
         or coalesce(with_check, '') ilike '%property-images%'
       )
  loop
    execute format('drop policy if exists %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  for table_name in
    select tablename
      from pg_tables
     where schemaname = 'public'
       and tablename <> 'spatial_ref_sys'
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;
end $$;

revoke all privileges on all sequences in schema public from anon, authenticated;
grant all privileges on all sequences in schema public to service_role;

revoke all on function public.lite_apply_scores(jsonb) from public, anon, authenticated;
revoke all on function public.lite_sync_top500_slots() from public, anon, authenticated;
grant execute on function public.lite_apply_scores(jsonb) to service_role;
grant execute on function public.lite_sync_top500_slots() to service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

do $$
begin
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated;
  alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated;
exception when insufficient_privilege then
  raise notice 'Could not change supabase_admin default privileges; postgres defaults were secured.';
end $$;
