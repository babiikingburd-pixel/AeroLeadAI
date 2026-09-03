import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseEvidenceCache } from "./cache";
import { makeEvidence } from "./evidence";

const DAKOTA_LAYER = "https://gis2.co.dakota.mn.us/arcgis/rest/services/Secure/DCGIS_OL_PropertyInformation/MapServer/4";
const DAKOTA_PROXY = "https://gis.co.dakota.mn.us/Proxy/proxy.ashx?";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CITIES = ["BURNSVILLE", "APPLE VALLEY", "EAGAN"] as const;

type City = (typeof CITIES)[number];
type Candidate = { parcelId: string; address: string; city: City; latitude: number; longitude: number; yearBuilt: number | null; effectiveYearBuilt: number | null; assessedValue: number | null };
const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");
const slug = (city: string) => city.toLowerCase().replace(/\s+/g, "-");

async function cityCandidates(city: City): Promise<Candidate[]> {
  const target = new URL(`${DAKOTA_LAYER}/query`);
  target.search = new URLSearchParams({
    where: `MUNICIPALITY = '${city}' AND DWELL_TYPE = 'S.FAM.RES'`,
    outFields: "TAXPIN,SITEADDRESS,MUNICIPALITY,YEAR_BUILT,EYRBLT,DWELL_TYPE,HOME_STYLE,TOTALVAL",
    returnGeometry: "true", outSR: "4326", orderByFields: "OBJECTID ASC", resultRecordCount: "2000", f: "json",
  }).toString();
  const response = await fetch(`${DAKOTA_PROXY}${target}`, { headers: { "user-agent": "AeroLeadAI-Oversight/1.1" }, signal: AbortSignal.timeout(25000), cache: "no-store" });
  if (!response.ok) throw new Error(`dakota_${slug(city)}_http_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`dakota_${slug(city)}_${body.error.message || "source_error"}`);
  return (body.features || []).filter((feature: any) => clean(feature.attributes?.DWELL_TYPE) === "S.FAM.RES" && clean(feature.attributes?.TAXPIN) && clean(feature.attributes?.SITEADDRESS) && Number.isFinite(Number(feature.geometry?.x)) && Number.isFinite(Number(feature.geometry?.y))).map((feature: any) => ({
    parcelId: `dakota-${clean(feature.attributes.TAXPIN)}`, address: clean(feature.attributes.SITEADDRESS), city,
    longitude: Number(feature.geometry.x), latitude: Number(feature.geometry.y),
    yearBuilt: Number.isFinite(Number(feature.attributes.YEAR_BUILT)) ? Number(feature.attributes.YEAR_BUILT) : null,
    effectiveYearBuilt: Number.isFinite(Number(feature.attributes.EYRBLT)) ? Number(feature.attributes.EYRBLT) : null,
    assessedValue: Number.isFinite(Number(feature.attributes.TOTALVAL)) ? Number(feature.attributes.TOTALVAL) : null,
  }));
}

async function censusMatch(candidate: Candidate) {
  const query = new URLSearchParams({ address: `${candidate.address}, ${candidate.city}, MN`, benchmark: "Public_AR_Current", format: "json" });
  const response = await fetch(`${CENSUS}?${query}`, { headers: { "user-agent": "AeroLeadAI-Oversight/1.1" }, signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) return null;
  const match = (await response.json())?.result?.addressMatches?.[0];
  if (!match) return null;
  return { matched_address: match.matchedAddress, latitude: match.coordinates?.y, longitude: match.coordinates?.x, tiger_line_id: match.tigerLine?.tigerLineId || null, zip: String(match.matchedAddress || "").match(/\b\d{5}\b/)?.[0] || null };
}

export async function runSouthernFrontDiscovery(db: SupabaseClient, options = { perCity: 8, censusPerCity: 4 }) {
  const { data: retained, error: retainedError } = await db.from("roof_profiles").select("parcel_id,ring_id").limit(20000);
  if (retainedError) throw new Error(`southern_retained_read_failed: ${retainedError.message}`);
  const seen = new Set((retained || []).map((row: any) => row.parcel_id));
  const cache = new SupabaseEvidenceCache(db);
  const cityResults = [];

  for (const city of CITIES) {
    const available = await cityCandidates(city);
    const selected = available.filter(row => !seen.has(row.parcelId)).slice(0, options.perCity);
    const matches = await Promise.all(selected.slice(0, options.censusPerCity).map(censusMatch));
    let verified = 0;
    for (let index = 0; index < selected.length; index++) {
      const parcel = selected[index];
      const match = index < matches.length ? matches[index] : null;
      const records = [makeEvidence({ parcelId: parcel.parcelId, type: "STRUCTURE", provider: "dakota_county_property_information", reality: "REAL_NOW", confidence: .95, sourceRef: DAKOTA_LAYER, payload: { address: parcel.address, city: parcel.city, latitude: parcel.latitude, longitude: parcel.longitude, year_built: parcel.yearBuilt, effective_year_built: parcel.effectiveYearBuilt, assessed_value: parcel.assessedValue, dwelling_type: "S.FAM.RES" } })];
      if (match) { verified++; records.push(makeEvidence({ parcelId: parcel.parcelId, type: "PROPERTY", provider: "us_census_geocoder", reality: "REAL_NOW", confidence: .9, sourceRef: "https://geocoding.geo.census.gov/geocoder/", payload: match })); }
      await cache.persist(records);
      const { error } = await db.from("roof_profiles").upsert({ parcel_id: parcel.parcelId, address: `${parcel.address}, ${parcel.city}, MN`, zip: match?.zip || null, ring_id: `south-${slug(city)}-front-1`, deployment_state: "evidence-collection", updated_at: new Date().toISOString() }, { onConflict: "parcel_id" });
      if (error) throw new Error(`southern_profile_write_failed: ${error.message}`);
      seen.add(parcel.parcelId);
    }
    const ringId = `south-${slug(city)}-front-1`;
    const cityRetained = (retained || []).filter((row: any) => row.ring_id === ringId).length + selected.length;
    const completionPct = available.length ? Math.min(100, Number(((cityRetained / available.length) * 100).toFixed(2))) : 0;
    const { error: ringError } = await db.from("ring_status").upsert({ ring_id: ringId, seed: `55431 -> ${city}`, completion_pct: completionPct, unlock_pct: Number((completionPct / 10).toFixed(2)), worker_target: 2, active: true, parcel_count: available.length, is_seed_ring: false, updated_at: new Date().toISOString() }, { onConflict: "ring_id" });
    if (ringError) throw new Error(`southern_ring_write_failed: ${ringError.message}`);
    cityResults.push({ city, available: available.length, imported: selected.length, censusVerified: verified, completionPct });
  }
  return { mode: "three-city-front-simultaneous", anchor: "55431", cities: cityResults, imported: cityResults.reduce((sum, row) => sum + row.imported, 0) };
}
