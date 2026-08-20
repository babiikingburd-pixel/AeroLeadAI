-- Bounded retention for the evidence network. The old project filled its disk
-- with unbounded evidence/image history; Lite keeps current scores and only a
-- small reproducible tail for each active property/lane.

create or replace function public.lite_prune_compact_data()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  task_rows integer := 0;
  finding_rows integer := 0;
  observation_rows integer := 0;
  cycle_rows integer := 0;
begin
  with ranked as (
    select task_id,
           row_number() over (
             partition by property_id, lane_name
             order by coalesce(finished_at, created_at) desc, task_id desc
           ) as rn
      from public.top500_crawler_tasks
     where status in ('completed', 'failed', 'cancelled')
  ), deleted as (
    delete from public.top500_crawler_tasks task
     using ranked
     where task.task_id = ranked.task_id
       and ranked.rn > 3
       and coalesce(task.finished_at, task.created_at) < now() - interval '14 days'
    returning 1
  )
  select count(*) into task_rows from deleted;

  with ranked as (
    select finding_id,
           row_number() over (
             partition by property_id, lane_name, coalesce(claim, '')
             order by created_at desc, finding_id desc
           ) as rn
      from public.top500_crawler_findings
  ), deleted as (
    delete from public.top500_crawler_findings finding
     using ranked
     where finding.finding_id = ranked.finding_id
       and ranked.rn > 5
       and finding.created_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into finding_rows from deleted;

  with ranked as (
    select id,
           row_number() over (
             partition by property_id
             order by coalesce(observed_at, created_at) desc, id desc
           ) as rn
      from public.aerolead_evidence_observations
  ), deleted as (
    delete from public.aerolead_evidence_observations observation
     using ranked
     where observation.id = ranked.id
       and (observation.expires_at < now() or ranked.rn > 100)
    returning 1
  )
  select count(*) into observation_rows from deleted;

  with deleted as (
    delete from public.twincities_apex_cycles
     where started_at < now() - interval '120 days'
    returning 1
  )
  select count(*) into cycle_rows from deleted;

  return jsonb_build_object(
    'tasks_deleted', task_rows,
    'findings_deleted', finding_rows,
    'observations_deleted', observation_rows,
    'cycles_deleted', cycle_rows
  );
end;
$$;

revoke all on function public.lite_prune_compact_data() from public, anon, authenticated;
grant execute on function public.lite_prune_compact_data() to service_role;
