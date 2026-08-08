-- APEX 14.0 predictive property layer
alter table if exists batch_leads
 add column if not exists condition_state jsonb default '{}'::jsonb,
 add column if not exists maintenance_prediction jsonb default '{}'::jsonb,
 add column if not exists safety_prediction jsonb default '{}'::jsonb,
 add column if not exists opportunity_prediction jsonb default '{}'::jsonb,
 add column if not exists maintenance_horizon text,
 add column if not exists necessity_score numeric default 0,
 add column if not exists opportunity_score numeric default 0,
 add column if not exists prediction_confidence numeric default 0,
 add column if not exists prediction_version text default 'APEX14.0';

create table if not exists property_predictions (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null,
 prediction_type text not null,
 horizon text not null,
 prediction text not null,
 probability numeric,
 urgency numeric,
 opportunity numeric,
 confidence numeric,
 evidence_refs jsonb default '[]'::jsonb,
 model_version text default 'APEX14.0',
 created_at timestamptz default now()
);
create index if not exists idx_property_predictions_property
 on property_predictions(property_id, created_at desc);
create index if not exists idx_property_predictions_rank
 on property_predictions(opportunity desc, urgency desc, probability desc);
