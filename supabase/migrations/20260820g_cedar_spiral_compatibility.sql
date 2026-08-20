-- The clean recovery schema was assembled from later migrations and did not
-- carry two original Batch Console columns still selected by current routes.
-- Restore them before importing the Cedar spiral parcel records.

alter table if exists public.batch_leads
  add column if not exists parcel_id text,
  add column if not exists stage text default 'queued';

create index if not exists idx_batch_leads_parcel_id
  on public.batch_leads(parcel_id)
  where parcel_id is not null;
