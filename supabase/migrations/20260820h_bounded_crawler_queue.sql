-- A queued task whose next_run_at is in the past is still an active task. The
-- original scheduler treated it as absent and could add another copy every
-- day while no worker was draining the queue. Enforce one active task per
-- slot/property/lane so a stopped crawler cannot fill the database again.

with ranked as (
  select task_id,
         row_number() over (
           partition by slot_no, property_id, lane_name
           order by created_at asc, task_id asc
         ) as rn
    from public.top500_crawler_tasks
   where status in ('queued', 'running')
)
update public.top500_crawler_tasks task
   set status = 'cancelled',
       finished_at = coalesce(task.finished_at, now()),
       last_error = coalesce(task.last_error, 'Duplicate active task removed by Lite queue guard')
  from ranked
 where task.task_id = ranked.task_id
   and ranked.rn > 1;

create unique index if not exists ux_top500_tasks_one_active_lane
  on public.top500_crawler_tasks(slot_no, property_id, lane_name)
  where status in ('queued', 'running');

create or replace function public.ensure_top500_crawler_tasks()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare inserted_count integer := 0;
begin
  insert into public.top500_crawler_tasks(
    slot_no, property_id, lane_name, priority, available_at, next_run_at
  )
  select slot.slot_no,
         slot.property_id,
         lane.lane_name,
         lane.priority + greatest(0, 500 - coalesce(slot.rank, 500)),
         coalesce(slot.next_investigation_at, now()),
         coalesce(slot.next_investigation_at, now())
    from public.top500_slots slot
    cross join public.top500_crawler_lanes lane
   where slot.status = 'occupied'
     and slot.property_id is not null
     and lane.enabled
     and not exists (
       select 1
         from public.top500_crawler_tasks task
        where task.slot_no = slot.slot_no
          and task.property_id = slot.property_id
          and task.lane_name = lane.lane_name
          and (
            task.status in ('queued', 'running')
            or coalesce(task.next_run_at, task.finished_at, task.created_at) > now()
          )
     )
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.schedule_due_top500_lanes()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare scheduled_count integer := 0;
begin
  insert into public.top500_crawler_tasks(
    slot_no, property_id, lane_name, priority, available_at, next_run_at
  )
  select slot.slot_no,
         slot.property_id,
         lane.lane_name,
         lane.priority + greatest(0, 500 - coalesce(slot.rank, 500)),
         now(),
         now()
    from public.top500_slots slot
    cross join public.top500_crawler_lanes lane
   where slot.status = 'occupied'
     and slot.property_id is not null
     and lane.enabled
     and not exists (
       select 1
         from public.top500_crawler_tasks task
        where task.slot_no = slot.slot_no
          and task.property_id = slot.property_id
          and task.lane_name = lane.lane_name
          and (
            task.status in ('queued', 'running')
            or coalesce(task.next_run_at, task.finished_at, task.created_at) > now()
          )
     )
  on conflict do nothing;
  get diagnostics scheduled_count = row_count;
  return scheduled_count;
end;
$$;

revoke all on function public.ensure_top500_crawler_tasks() from public, anon, authenticated;
revoke all on function public.schedule_due_top500_lanes() from public, anon, authenticated;
grant execute on function public.ensure_top500_crawler_tasks() to service_role;
grant execute on function public.schedule_due_top500_lanes() to service_role;
