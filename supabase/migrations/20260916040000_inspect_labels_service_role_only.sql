-- Harden inspect/label persistence. Vercel has no durable local disk, so
-- labels live in Postgres and are reachable only through the service role.

create table if not exists public.oversight_property_labels (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
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

-- If an earlier inspect experiment created property_inspect_labels with
-- using (true) policies, lock that table down. New writes go to
-- oversight_property_labels keyed by (property_id, shot_key).
do $$
begin
  if to_regclass('public.property_inspect_labels') is not null then
    alter table public.property_inspect_labels enable row level security;
    revoke all on table public.property_inspect_labels from public, anon, authenticated;
    grant select, insert, update, delete on table public.property_inspect_labels to service_role;
    execute 'drop policy if exists "Allow inspect label read" on public.property_inspect_labels';
    execute 'drop policy if exists "Allow inspect label insert" on public.property_inspect_labels';
    execute 'drop policy if exists "Allow inspect label update" on public.property_inspect_labels';
  end if;
end
$$;
