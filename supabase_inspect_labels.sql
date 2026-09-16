-- Inspect labels (human boxes + verdicts). Run in Supabase SQL editor.
-- Additive. Does not touch permits or properties.

create table if not exists property_inspect_labels (
  property_id text primary key,
  address text,
  lat double precision,
  lon double precision,
  shot_key text,
  source text,
  gsd_note text,
  boxes jsonb not null default '[]'::jsonb,
  verdict text,
  notes text,
  labeled_at timestamptz,
  updated_at timestamptz default now()
);

create index if not exists idx_inspect_labels_verdict on property_inspect_labels (verdict);
create index if not exists idx_inspect_labels_labeled_at on property_inspect_labels (labeled_at desc);

alter table property_inspect_labels enable row level security;

drop policy if exists "Allow inspect label read" on property_inspect_labels;
create policy "Allow inspect label read" on property_inspect_labels for select using (true);
drop policy if exists "Allow inspect label insert" on property_inspect_labels;
create policy "Allow inspect label insert" on property_inspect_labels for insert with check (true);
drop policy if exists "Allow inspect label update" on property_inspect_labels;
create policy "Allow inspect label update" on property_inspect_labels for update using (true);
