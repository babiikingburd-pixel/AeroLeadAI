-- Cover the compact evidence/imagery foreign keys used by daily Lite refreshes.
-- These indexes keep deletes, slot replacement, and per-property evidence reads
-- predictable once the Minnesota Top 500 is populated.

create index if not exists idx_imagery_manifest_history_property
  on public.imagery_manifest_history(property_id);

create index if not exists idx_top500_findings_property
  on public.top500_crawler_findings(property_id);

create index if not exists idx_top500_findings_slot
  on public.top500_crawler_findings(slot_no);

create index if not exists idx_top500_tasks_property
  on public.top500_crawler_tasks(property_id);

create index if not exists idx_top500_tasks_lane
  on public.top500_crawler_tasks(lane_name);
