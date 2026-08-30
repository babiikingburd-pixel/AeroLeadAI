import type { SupabaseClient } from "@supabase/supabase-js";
import { makeEvidence } from "./evidence";
import { evaluateEvidence } from "./gatekeeper";
import { SupabaseEvidenceCache } from "./cache";

const HENNEPIN = "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

type Candidate = { parcelId: string; address: string; city: string; zip: string; latitude: number; longitude: number; yearBuilt: number | null; assessedValue: number | null };

function clean(value: unknown) { return String(value ?? "").trim().replace(/\s+/g, " "); }

async function countyCandidates(zip: string): Promise<Candidate[]> {
  const params = new URLSearchParams({
    f: "json",
    where: `ZIP_CD = '${zip.replace(/[^0-9]/g, "")}' AND PR_TYP_NM1 = 'RESIDENTIAL' AND LAT IS NOT NULL AND LON IS NOT NULL AND HOUSE_NO IS NOT NULL`,
    outFields: "PID,HOUSE_NO,FRAC_HOUSE_NO,STREET_NM,ZIP_CD,MUNIC_NM,BUILD_YR,PR_TYP_NM1,MKT_VAL_TOT,MULTI_ADDR_IND,CONDO_NO,PROPERTY_STATUS_CD,LAT,LON",
    returnGeometry: "false", orderByFields: "PID ASC", resultRecordCount: "2000",
  });
  const response = await fetch(HENNEPIN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "AeroLeadAI-Oversight/1.1" }, body: params, signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error(`hennepin_http_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`hennepin_source_${body.error.message || "error"}`);
  return (body.features || []).map((feature: any) => feature.attributes).filter((a: any) => {
    const multi = clean(a.MULTI_ADDR_IND).toLowerCase();
    return clean(a.PID) && clean(a.PR_TYP_NM1).toUpperCase() === "RESIDENTIAL" && !clean(a.CONDO_NO) &&
      !["y", "yes", "true", "1"].includes(multi) && (!clean(a.PROPERTY_STATUS_CD) || clean(a.PROPERTY_STATUS_CD) === "0") &&
      clean(a.HOUSE_NO) && clean(a.STREET_NM) && Number.isFinite(Number(a.LAT)) && Number.isFinite(Number(a.LON));
  }).map((a: any) => ({
    parcelId: clean(a.PID), address: [clean(a.HOUSE_NO), clean(a.FRAC_HOUSE_NO), clean(a.STREET_NM)].filter(Boolean).join(" "),
    city: clean(a.MUNIC_NM) || "Bloomington", zip, latitude: Number(a.LAT), longitude: Number(a.LON),
    yearBuilt: Number.isFinite(Number(a.BUILD_YR)) ? Number(a.BUILD_YR) : null,
    assessedValue: Number.isFinite(Number(a.MKT_VAL_TOT)) ? Number(a.MKT_VAL_TOT) : null,
  }));
}

async function censusMatch(candidate: Candidate) {
  const query = new URLSearchParams({ address: `${candidate.address}, ${candidate.city}, MN ${candidate.zip}`, benchmark: "Public_AR_Current", format: "json" });
  const response = await fetch(`${CENSUS}?${query}`, { headers: { "user-agent": "AeroLeadAI-Oversight/1.1" }, signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) return null;
  const match = (await response.json())?.result?.addressMatches?.[0];
  return match ? { matched_address: match.matchedAddress, latitude: match.coordinates?.y, longitude: match.coordinates?.x, tiger_line_id: match.tigerLine?.tigerLineId || null } : null;
}

export async function runOversightDiscovery(db: SupabaseClient, options: { zip: string; importLimit: number; censusLimit: number }) {
  const candidates = await countyCandidates(options.zip);
  const { data: existing, error: existingError } = await db.from("roof_profiles").select("parcel_id").eq("zip", options.zip).limit(10000);
  if (existingError) throw new Error(`existing_profiles_read_failed: ${existingError.message}`);
  const seen = new Set((existing || []).map((row: any) => row.parcel_id));
  const selected = candidates.filter(row => !seen.has(row.parcelId)).slice(0, options.importLimit);
  const census = await Promise.all(selected.slice(0, options.censusLimit).map(censusMatch));
  const cache = new SupabaseEvidenceCache(db);
  let verified = 0;
  for (let index = 0; index < selected.length; index++) {
    const parcel = selected[index];
    const records = [makeEvidence({ parcelId: parcel.parcelId, type: "STRUCTURE", provider: "hennepin_county_land_property", reality: "REAL_NOW", confidence: .95, sourceRef: HENNEPIN, payload: { address: parcel.address, city: parcel.city, zip: parcel.zip, latitude: parcel.latitude, longitude: parcel.longitude, year_built: parcel.yearBuilt, assessed_value: parcel.assessedValue, property_type: "single-family residential" } })];
    if (index < census.length && census[index]) {
      verified++;
      records.push(makeEvidence({ parcelId: parcel.parcelId, type: "PROPERTY", provider: "us_census_geocoder", reality: "REAL_NOW", confidence: .9, sourceRef: "https://geocoding.geo.census.gov/geocoder/", payload: census[index]! }));
    }
    await cache.persist(records);
    const decision = evaluateEvidence(records);
    const { error } = await db.from("roof_profiles").upsert({ parcel_id: parcel.parcelId, address: parcel.address, zip: parcel.zip, ring_id: `zip-${parcel.zip}-ring-0`, deployment_state: "evidence-collection", state: decision.state, gate_allowed: decision.allowed, gate_reasons: decision.reasons, opportunity: decision.opportunity, evidence_confidence: decision.evidenceConfidence, commercial_priority: decision.commercialPriority, contradictions: decision.contradictions, corroborations: decision.corroborations, completion_pct: decision.completionPct, deep_dive_tier: decision.deepDiveTier, updated_at: new Date().toISOString() }, { onConflict: "parcel_id" });
    if (error) throw new Error(`profile_write_failed: ${error.message}`);
  }
  const totalRetained = seen.size + selected.length;
  const completionPct = candidates.length ? Math.min(100, Number(((totalRetained / candidates.length) * 100).toFixed(2))) : 0;
  const { error: ringError } = await db.from("ring_status").upsert({ ring_id: `zip-${options.zip}-ring-0`, seed: options.zip, completion_pct: completionPct, unlock_pct: Number((completionPct / 10).toFixed(2)), worker_target: 4, active: true, parcel_count: candidates.length, is_seed_ring: true, updated_at: new Date().toISOString() }, { onConflict: "ring_id" });
  if (ringError) throw new Error(`ring_write_failed: ${ringError.message}`);
  return { territory: options.zip, sourceCandidates: candidates.length, imported: selected.length, censusVerified: verified, retained: totalRetained, completionPct, nextRingUnlockPct: Number((completionPct / 10).toFixed(2)) };
}

