-- Backs /api/image-crawler: one row per successfully fetched + stored
-- property image, so re-runs can tell which batch_leads rows still need
-- one without re-fetching or re-uploading. Append-only log, same idiom as
-- imagery_history in supabase_batch_leads_schema.sql (read + insert only,
-- no update policy).

create table if not exists property_images (
  id bigserial primary key,
  lead_id text not null references batch_leads(id) on delete cascade,
  county text,
  address text,
  lat double precision,
  lon double precision,
  provider text not null, -- 'google' | 'mapbox' | 'esri'
  storage_path text not null, -- path within the property-images Storage bucket
  public_url text,
  fetched_at timestamptz default now()
);

create index if not exists idx_property_images_lead_id on property_images (lead_id);
create index if not exists idx_property_images_county on property_images (county);

alter table property_images enable row level security;
do $$ begin
  create policy "Allow anon read" on property_images for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on property_images for insert with check (true);
exception when duplicate_object then null; end $$;
