-- Match the worker's terminal status with Lite retention. Rows previously
-- marked "complete" were invisible to the completed/failed/cancelled pruning
-- window and could accumulate indefinitely.

update public.top500_crawler_tasks
   set status = 'completed'
 where status = 'complete';
