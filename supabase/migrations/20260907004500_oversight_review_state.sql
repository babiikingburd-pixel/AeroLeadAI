-- Restore the original interactive review controls on the active Oversight
-- property model. Review is an annotation and never blocks collection-mode
-- publication while GateKeeper is paused.
alter table public.roof_profiles
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending','approved','partial','rejected','needs_images','contractor_sent')),
  add column if not exists review_status_updated_at timestamptz,
  add column if not exists human_review_notes text;

create index if not exists roof_profiles_review_status_idx
  on public.roof_profiles(review_status, live_rank)
  where review_status <> 'pending';
