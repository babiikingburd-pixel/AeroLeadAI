-- Accelerated Hobby backfill: claim only the requested evidence lane so the
-- extra daily shards stop cleanly once Top 500 imagery is populated. The
-- existing general worker remains unchanged for balanced evidence cycles.

create or replace function public.claim_top500_crawler_tasks_by_lane(
  p_worker_id text,
  p_lane_name text,
  p_limit integer default 4
)
returns setof public.top500_crawler_tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select task.task_id
      from public.top500_crawler_tasks task
     where task.status = 'queued'
       and task.lane_name = p_lane_name
       and task.available_at <= now()
       and coalesce(task.next_run_at, task.available_at) <= now()
       and task.attempts < task.max_attempts
     order by task.priority desc, task.available_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 4), 8))
  )
  update public.top500_crawler_tasks task
     set status = 'running',
         locked_by = p_worker_id,
         locked_at = now(),
         started_at = now(),
         attempts = task.attempts + 1
    from picked
   where task.task_id = picked.task_id
  returning task.*;
end;
$$;

revoke all on function public.claim_top500_crawler_tasks_by_lane(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_top500_crawler_tasks_by_lane(text, text, integer)
  to service_role;
