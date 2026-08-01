-- Twin Cities Priority Engine — adds property-value, storm-evidence, and
-- human-review columns to batch_leads. Safe to re-run (every statement is
-- idempotent), matching the style of the other supabase_*_schema.sql files
-- in this repo.
--
-- Run in Supabase: Project > SQL Editor > New query.

alter table batch_leads add column if not exists county text;
alter table batch_leads add column if not exists year_built integer;

-- Property value (Route: county assessor GIS -> lib/twincities/propertyValue.js)
alter table batch_leads add column if not exists assessed_value bigint default 0;
alter table batch_leads add column if not exists assessed_year integer;
alter table batch_leads add column if not exists value_source text; -- e.g. 'hennepin_arcgis'

-- Storm evidence (Route: NOAA/NWS -> lib/twincities/priorityEngine.js)
alter table batch_leads add column if not exists hail_inches numeric;
alter table batch_leads add column if not exists wind_mph numeric;
alter table batch_leads add column if not exists storm_date date;

-- Evidence Index v1.1 output
alter table batch_leads add column if not exists evidence_score integer default 0;
alter table batch_leads add column if not exists evidence_categories text[] default '{}'; -- which categories fired, for the "3+ categories" human-review rule
alter table batch_leads add column if not exists confidence_score integer default 0;
alter table batch_leads add column if not exists priority_score numeric default 0; -- final weighted+county-multiplier score used for top-leads ranking

-- Human review workflow
alter table batch_leads add column if not exists human_review boolean default false;
alter table batch_leads add column if not exists human_review_notes text;
alter table batch_leads add column if not exists human_review_status text; -- 'pending' | 'approved' | 'partial' | 'rejected'

create index if not exists idx_batch_leads_county on batch_leads (county);
create index if not exists idx_batch_leads_priority_score on batch_leads (priority_score desc);
create index if not exists idx_batch_leads_human_review on batch_leads (human_review);

-- RLS already enabled on batch_leads by supabase_batch_leads_schema.sql;
-- new columns inherit the existing anon-open policies, no new policy needed.
