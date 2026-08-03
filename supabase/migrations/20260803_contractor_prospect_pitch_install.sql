-- Additive contractor prospect/pitch layer. Does NOT promote prospects into live contractors.
alter table contractor_candidates add column if not exists prospect boolean default false;
alter table contractor_candidates add column if not exists website text;
alter table contractor_candidates add column if not exists city text;
alter table contractor_candidates add column if not exists state text;
alter table contractor_candidates add column if not exists service_area_cities text[] default '{}';
alter table contractor_candidates add column if not exists prospect_score integer default 0;
alter table contractor_candidates add column if not exists pitch_status text default 'not_started';
alter table contractor_candidates add column if not exists pitch_last_generated_at timestamptz;
alter table contractor_candidates add column if not exists pitch_notes text;
create index if not exists idx_contractor_candidates_prospects on contractor_candidates(prospect, prospect_score desc);

-- Seed the contractor prospects discussed for the Twin Cities outreach test.
-- These remain contractor_candidates/prospects, NOT verified contractors.
insert into contractor_candidates
(business_name, phone, email, service_types, status, prospect, website, city, state, service_area_cities, prospect_score, pitch_notes)
values
('APEX Exteriors LLC','612-456-2255',null,array['roof','storm'], 'pending_verification',true,'https://www.apexexteriorsmn.com/','Plymouth','MN',array['Plymouth','Maple Grove','Brooklyn Park','Champlin','Golden Valley'],96,'Storm-damage specialist; strongest initial pitch fit.'),
('Incline Exteriors','952-471-9065','contact@inclineexteriors.com',array['roof','siding','windows','gutters'], 'pending_verification',true,'https://inclineexteriors.com/','Excelsior','MN',array['Excelsior','Deephaven','Minnetonka','Chanhassen','Chaska','Edina','Eden Prairie','Wayzata'],92,'Strong west-metro fit; emphasize territory intelligence and no door-knocking.'),
('Grussing Roofing & Exteriors','952-935-0557',null,array['roof','storm','siding','windows','gutters'], 'pending_verification',true,'https://grussingroofing.com/','Eden Prairie','MN',array['Eden Prairie','Edina','St Louis Park','Chaska','Chanhassen','Maple Grove','Bloomington'],91,'Long-running local operator with storm/insurance positioning.'),
('Storm ReNu','612-207-1661',null,array['roof','storm','restoration'], 'pending_verification',true,null,'Bloomington','MN',array['Bloomington','Richfield','Edina','Eagan','Burnsville'],90,'Storm-restoration fit; pitch rapid post-storm opportunity discovery.'),
('Keyprime Roofing and Remodeling','952-522-3705','info@keyprimeroofing.com',array['roof','storm','siding','windows','gutters'], 'pending_verification',true,'https://www.keyprimeroofing.com/','Golden Valley','MN',array['Golden Valley','Robbinsdale','St Louis Park','Plymouth','Maple Grove','Minneapolis'],89,'Strong storm-restoration and metro fit; pitch lead prioritization.'),
('J Robert Roofing','612-998-1673',null,array['roof','storm','siding','gutters'], 'pending_verification',true,'https://jrobertroofing.com/','Eden Prairie','MN',array['Eden Prairie','Minnetonka','Edina','Chanhassen','Chaska','Bloomington'],88,'Residential roofing plus hail/storm repair; strong local proof-of-concept target.'),
('Timberline Roofing & Contracting Inc','952-900-5603',null,array['roof','siding','gutters','windows'], 'pending_verification',true,null,'Plymouth','MN',array['Plymouth','Maple Grove','Wayzata','Minnetonka','Brooklyn Park'],86,'Good west-metro roofing prospect; pitch cluster-based canvassing.'),
('T & J Construction','612-249-8522',null,array['roof','restoration','siding','gutters'], 'pending_verification',true,'https://www.tjconstructionmn.com/','Plymouth','MN',array['Plymouth','Maple Grove','St Cloud','Brooklyn Park'],84,'Restoration/exterior fit; pitch concentrated opportunity lists.'),
('Bayport Roofing and Siding','612-235-7663','contact@bayportroofing.com',array['roof','siding','storm'], 'pending_verification',true,'https://www.bayportroofing.com/','St Louis Park','MN',array['St Louis Park','Minneapolis','Golden Valley','Edina','Richfield','Bloomington'],83,'Established Twin Cities operator; pitch storm/inspection prioritization.'),
('A-1 Restoration','952-529-1157',null,array['roof','storm','siding','windows'], 'pending_verification',true,'https://a-1restore.com/','Plymouth','MN',array['Plymouth','Bloomington','Carver','Chanhassen','Chaska','Deephaven','Eden Prairie','Edina','Golden Valley','Excelsior','Hopkins'],87,'Local storm-damage/restoration operator; strong service-area match.')
on conflict do nothing;
