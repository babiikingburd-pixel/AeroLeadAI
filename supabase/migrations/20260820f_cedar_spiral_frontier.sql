-- Start AeroLeadAI Lite at 8600 Cedar Ave S and move outward in deterministic
-- 0.05-mile rings. Only the current Top 500 are retained; the small frontier
-- row remembers where the next daily Hobby-plan pass should resume.

alter table if exists public.batch_leads
  add column if not exists parcel_source_id text,
  add column if not exists parcel_source_updated_at timestamptz,
  add column if not exists spiral_seed_id text,
  add column if not exists spiral_distance_miles double precision,
  add column if not exists spiral_bearing_degrees double precision,
  add column if not exists spiral_ring integer;

create index if not exists idx_batch_leads_spiral_order
  on public.batch_leads(spiral_seed_id, spiral_ring, spiral_bearing_degrees, spiral_distance_miles);
create index if not exists idx_batch_leads_parcel_source
  on public.batch_leads(source, parcel_source_id)
  where parcel_source_id is not null;

create table if not exists public.aerolead_spiral_frontiers (
  seed_id text primary key,
  seed_address text not null,
  canonical_seed_address text not null,
  seed_lat double precision not null,
  seed_lon double precision not null,
  phase text not null default 'hennepin',
  source_name text not null,
  ring_width_miles double precision not null default 0.05,
  current_radius_miles double precision not null default 0.5,
  last_ring integer not null default -1,
  last_bearing_degrees double precision not null default -1,
  last_distance_miles double precision not null default -1,
  last_source_id text,
  imported_total bigint not null default 0,
  status text not null default 'active',
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_run_stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.aerolead_spiral_frontiers(
  seed_id, seed_address, canonical_seed_address, seed_lat, seed_lon, source_name
)
values (
  'cedar-8600',
  '8600 Cedar Ave S, Bloomington, MN 55425',
  '8600 Old Cedar Ave S, Bloomington, MN 55425',
  44.847598575765005,
  -93.24879799628836,
  'Hennepin County monthly parcel data'
)
on conflict(seed_id) do update set
  seed_address = excluded.seed_address,
  canonical_seed_address = excluded.canonical_seed_address,
  seed_lat = excluded.seed_lat,
  seed_lon = excluded.seed_lon,
  source_name = excluded.source_name,
  updated_at = now();

create or replace function public.lite_prune_spiral_candidates(
  p_seed_id text default 'cedar-8600',
  p_keep integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  deleted_rows integer := 0;
  retained_rows integer := 0;
begin
  if p_keep < 1 or p_keep > 1500 then
    raise exception 'p_keep must be between 1 and 1500';
  end if;

  with removed as (
    delete from public.batch_leads lead
     where lead.spiral_seed_id = p_seed_id
       and (lead.lite_rank is null or lead.lite_rank > p_keep)
    returning 1
  )
  select count(*) into deleted_rows from removed;

  select count(*) into retained_rows
    from public.batch_leads
   where spiral_seed_id = p_seed_id;

  return jsonb_build_object(
    'seed_id', p_seed_id,
    'deleted', deleted_rows,
    'retained', retained_rows,
    'limit', p_keep
  );
end;
$$;

alter table public.aerolead_spiral_frontiers enable row level security;
revoke all privileges on table public.aerolead_spiral_frontiers from public, anon, authenticated;
grant all privileges on table public.aerolead_spiral_frontiers to service_role;
revoke all on function public.lite_prune_spiral_candidates(text, integer) from public, anon, authenticated;
grant execute on function public.lite_prune_spiral_candidates(text, integer) to service_role;
