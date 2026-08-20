-- A rank replacement must not leave the prior property's crawler jobs alive
-- in that slot. Reconcile active tasks after each deterministic slot sync.

create or replace function public.lite_cancel_stale_top500_tasks()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cancelled integer := 0;
begin
  update public.top500_crawler_tasks task
     set status = 'cancelled',
         finished_at = coalesce(task.finished_at, now()),
         last_error = coalesce(task.last_error, 'Slot/property left the current Lite Top 500')
   where task.status in ('queued', 'running')
     and not exists (
       select 1
         from public.top500_slots slot
        where slot.slot_no = task.slot_no
          and slot.property_id = task.property_id
          and slot.status = 'occupied'
     );
  get diagnostics cancelled = row_count;
  return cancelled;
end;
$$;

revoke all on function public.lite_cancel_stale_top500_tasks() from public, anon, authenticated;
grant execute on function public.lite_cancel_stale_top500_tasks() to service_role;
