-- Repair the Census ZIP parsing bug that treated a five-digit house number
-- as the postal ZIP. The correct ZIP is already present at the end of each
-- stored Census matched_address, so this correction makes no external call.
create temporary table oversight_zip_corrections on commit drop as
select distinct on (e.parcel_id)
  e.parcel_id,
  (regexp_match(e.payload->>'matched_address', '([0-9]{5})(-[0-9]{4})?$'))[1] as correct_zip
from public.evidence_records e
where e.type = 'PROPERTY'
  and e.reality in ('REAL_NOW','CACHED_REAL')
  and e.payload->>'matched_address' is not null
order by e.parcel_id, e.captured_at desc;

delete from oversight_zip_corrections where correct_zip is null;

alter table public.evidence_records disable trigger oversight_doctor_evidence_trigger;
update public.evidence_records e
set payload = jsonb_set(e.payload, '{zip}', to_jsonb(c.correct_zip), true)
from oversight_zip_corrections c
where e.parcel_id = c.parcel_id
  and e.type = 'PROPERTY'
  and e.payload->>'matched_address' is not null
  and e.payload->>'zip' is distinct from c.correct_zip;
alter table public.evidence_records enable trigger oversight_doctor_evidence_trigger;

alter table public.roof_profiles disable trigger oversight_doctor_profile_trigger;
update public.roof_profiles p
set zip = c.correct_zip,
    updated_at = now()
from oversight_zip_corrections c
where p.parcel_id = c.parcel_id
  and p.zip is distinct from c.correct_zip;
alter table public.roof_profiles enable trigger oversight_doctor_profile_trigger;

-- Refresh Doctor state for only the corrected parcels, then rebuild the
-- collection leaderboard once instead of once per row.
alter table public.oversight_property_audits disable trigger oversight_leaderboard_audit_trigger;
do $$
declare item record;
begin
  for item in select parcel_id from oversight_zip_corrections loop
    perform public.refresh_oversight_doctor(item.parcel_id);
  end loop;
end;
$$;
alter table public.oversight_property_audits enable trigger oversight_leaderboard_audit_trigger;

select public.refresh_oversight_leaderboard();
