-- AeroLeadAI Console State (magic-link auth + cross-device sync)
-- Run once in your Supabase project's SQL Editor (Project > SQL Editor > New query).
--
-- Backs the main deep-dive console's persistence (properties, memory, etc.)
-- when NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are set —
-- without this table, Supabase-backed storage silently falls back to
-- localStorage (same as having no key configured at all).

create table if not exists propintel_state (
  key text not null,
  value text not null,
  user_id uuid references auth.users(id),
  updated_at timestamptz default now(),
  primary key (key, user_id)
);

alter table propintel_state enable row level security;

do $$ begin
  create policy "Users manage their own state" on propintel_state
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
