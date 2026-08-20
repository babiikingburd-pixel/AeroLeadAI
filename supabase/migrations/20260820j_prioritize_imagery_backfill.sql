-- The Top 500 currently has no imagery manifests. Put one overhead-imagery
-- task for every occupied slot ahead of slower secondary lanes, then wait for
-- the 30-day cache horizon before scheduling that property again.

update public.top500_crawler_lanes
   set priority = 2000
 where lane_name = 'imagery';

-- Older AeroLeadAI snapshots called this cadence_seconds; the full APEX 14.1
-- schema called it interval_seconds. Keep the migration safe for both.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'top500_crawler_lanes'
       and column_name = 'cadence_seconds'
  ) then
    execute 'update public.top500_crawler_lanes set cadence_seconds = 2592000 where lane_name = ''imagery''';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'top500_crawler_lanes'
       and column_name = 'interval_seconds'
  ) then
    execute 'update public.top500_crawler_lanes set interval_seconds = 2592000 where lane_name = ''imagery''';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'top500_crawler_lanes'
       and column_name = 'description'
  ) then
    execute 'update public.top500_crawler_lanes set description = ''Acquire cached overhead roof imagery first; refresh on the 30-day source horizon.'' where lane_name = ''imagery''';
  end if;
end $$;

update public.top500_crawler_tasks task
   set priority = 2000 + greatest(0, 500 - coalesce(slot.rank, 500))
  from public.top500_slots slot
 where task.slot_no = slot.slot_no
   and task.property_id = slot.property_id
   and task.lane_name = 'imagery'
   and task.status in ('queued', 'running');
