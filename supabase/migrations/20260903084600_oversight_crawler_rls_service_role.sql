alter table public.oversight_crawler_jobs enable row level security;
alter table public.oversight_crawler_runs enable row level security;

revoke all on public.oversight_crawler_jobs, public.oversight_crawler_runs
  from public, anon, authenticated;
grant all on public.oversight_crawler_jobs, public.oversight_crawler_runs
  to service_role;

drop policy if exists "service_role_all_oversight_crawler_jobs" on public.oversight_crawler_jobs;
create policy "service_role_all_oversight_crawler_jobs"
  on public.oversight_crawler_jobs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_all_oversight_crawler_runs" on public.oversight_crawler_runs;
create policy "service_role_all_oversight_crawler_runs"
  on public.oversight_crawler_runs
  for all
  to service_role
  using (true)
  with check (true);
