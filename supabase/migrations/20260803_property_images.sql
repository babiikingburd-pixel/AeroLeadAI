-- Backs /api/image-crawler.
--
-- NOTE: this table already exists live in Supabase — it was created by an
-- earlier session directly against the project, from a
-- supabase_property_images_schema.sql referenced (but never committed) in
-- supabase_autonomy_schema.sql's header comment. This migration documents
-- that real, already-applied shape in-repo (property_id/image_url, plus the
-- damage_* columns an image-scoring pass writes separately) so a fresh
-- environment ends up matching production instead of diverging from it.
-- "if not exists"/duplicate_object guards make it a no-op where it already
-- exists, same idiom as the rest of this repo's supabase_*_schema.sql files.

create table if not exists property_images (
  id bigserial primary key,
  property_id text not null references batch_leads(id) on delete cascade,
  county text,
  city text,
  address text,
  provider text, -- 'google' | 'mapbox' | 'esri'
  view text default 'center',
  storage_path text, -- path within the property-images Storage bucket
  image_url text,
  damage_score numeric,
  damage_status text,
  damage_reasons text,
  fetched_at timestamptz default now()
);

create index if not exists idx_property_images_property_id on property_images (property_id);
create index if not exists idx_property_images_county on property_images (county);

alter table property_images enable row level security;
do $$ begin
  create policy "Allow anon read" on property_images for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Allow anon insert" on property_images for insert with check (true);
exception when duplicate_object then null; end $$;
