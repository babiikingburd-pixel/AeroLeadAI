create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-images', 'property-images', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.oversight_pulse_state (
  pulse_name text primary key,
  worker_id text,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.oversight_pulse_tokens (
  token_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_oversight_evidence_parcel_type_reality
  on public.evidence_records(parcel_id, type, reality, captured_at desc);
create index if not exists idx_oversight_pulse_tokens_expiry
  on public.oversight_pulse_tokens(expires_at) where used_at is null;

alter table public.oversight_pulse_state enable row level security;
alter table public.oversight_pulse_tokens enable row level security;
revoke all on public.oversight_pulse_state, public.oversight_pulse_tokens from public, anon, authenticated;
grant all on public.oversight_pulse_state, public.oversight_pulse_tokens to service_role;

drop policy if exists "service_role_all_oversight_pulse_state" on public.oversight_pulse_state;
create policy "service_role_all_oversight_pulse_state" on public.oversight_pulse_state
  for all to service_role using (true) with check (true);
drop policy if exists "service_role_all_oversight_pulse_tokens" on public.oversight_pulse_tokens;
create policy "service_role_all_oversight_pulse_tokens" on public.oversight_pulse_tokens
  for all to service_role using (true) with check (true);

create or replace function public.claim_oversight_pulse(
  p_worker_id text,
  p_lease_seconds integer default 240,
  p_min_interval_seconds integer default 240
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed integer;
begin
  insert into public.oversight_pulse_state(pulse_name)
  values ('evidence-enrichment')
  on conflict (pulse_name) do nothing;

  update public.oversight_pulse_state
     set worker_id = p_worker_id,
         lease_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
         last_started_at = now(),
         updated_at = now()
   where pulse_name = 'evidence-enrichment'
     and coalesce(lease_until, '-infinity'::timestamptz) < now()
     and coalesce(last_started_at, '-infinity'::timestamptz) < now() - make_interval(secs => greatest(30, p_min_interval_seconds));
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;

create or replace function public.finish_oversight_pulse(p_worker_id text, p_result jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.oversight_pulse_state
     set lease_until = now(),
         last_finished_at = now(),
         last_result = coalesce(p_result, '{}'::jsonb),
         updated_at = now()
   where pulse_name = 'evidence-enrichment' and worker_id = p_worker_id;
$$;

revoke all on function public.claim_oversight_pulse(text, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_oversight_pulse(text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_oversight_pulse(text, integer, integer) to service_role;
grant execute on function public.finish_oversight_pulse(text, jsonb) to service_role;

-- Populate these two Vault entries during deployment. Keeping the values out
-- of source control lets the same migration be reused safely in every project.
--   oversight_project_url
--   oversight_publishable_key
select cron.schedule(
  'oversight-evidence-pulse-five-minutes',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='oversight_project_url') || '/functions/v1/oversight-pulse',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='oversight_publishable_key')
    ),
    body := jsonb_build_object('source','supabase-cron','scheduled_at',now()),
    timeout_milliseconds := 50000
  );
  $job$
);

delete from public.oversight_pulse_tokens where expires_at < now() - interval '1 day';
