import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseEvidenceCache } from "./cache";
import { makeEvidence } from "./evidence";

export const NATIVE_REQUIREMENTS = new Set([
  "identity",
  "permit_history",
  "weather_history",
  "imagery_capture",
  "imagery_date",
  "imagery_analysis",
]);

export function supportsNativeRequirement(requirement: string) {
  return NATIVE_REQUIREMENTS.has(requirement);
}

type NativeContext = {
  db: SupabaseClient;
  origin: string;
  profile: any;
  structure?: any;
  requirement: string;
};

type NativeResult = {
  satisfied: boolean;
  provider: string;
  detail?: Record<string, unknown>;
};

const PROPERTY_IMAGES_BUCKET = "property-images";
const WEATHER_LOOKBACK_YEARS = 10;

function internalHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  else if (process.env.INTERNAL_API_KEY) headers["x-api-key"] = process.env.INTERNAL_API_KEY;
  return headers;
}

function coords(profile: any, structure: any) {
  const latitude = Number(structure?.latitude ?? profile?.latitude ?? profile?.lat);
  const longitude = Number(structure?.longitude ?? profile?.longitude ?? profile?.lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function confidenceNumber(value: unknown, fallback = 0.5) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  const text = String(value || "").toLowerCase();
  if (text === "high") return 0.88;
  if (text === "medium") return 0.68;
  if (text === "low") return 0.42;
  return fallback;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 20_000) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${new URL(url).pathname}_http_${response.status}: ${String(body?.error || body?.message || "request_failed").slice(0, 180)}`);
  return body;
}

async function persist(db: SupabaseClient, input: Parameters<typeof makeEvidence>[0]) {
  const record = makeEvidence(input);
  await new SupabaseEvidenceCache(db).persist([record]);
  return record;
}

async function latestStoredImage(db: SupabaseClient, parcelId: string) {
  const { data, error } = await db
    .from("property_images")
    .select("property_id,provider,view,storage_path,mime_type,quality_score,fetched_at")
    .eq("property_id", parcelId)
    .order("fetched_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`property_image_read_failed: ${error.message}`);
  const rows = data || [];
  return rows.find((row: any) => row.view === "overview_tight")
    || rows.find((row: any) => row.view === "overview_context")
    || rows[0]
    || null;
}

async function latestImageryEvidence(db: SupabaseClient, parcelId: string) {
  const { data, error } = await db
    .from("evidence_records")
    .select("payload,provider,confidence,effective_at,captured_at")
    .eq("parcel_id", parcelId)
    .eq("type", "IMAGERY")
    .in("reality", ["REAL_NOW", "CACHED_REAL"])
    .order("captured_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`imagery_evidence_read_failed: ${error.message}`);
  return (data || []).find((row: any) => row.payload?.storage_path) || null;
}

async function acquireImagery(ctx: NativeContext, force = false) {
  const location = coords(ctx.profile, ctx.structure);
  if (!location) throw new Error("imagery_requires_verified_coordinates");
  const rank = Number(ctx.profile?.live_rank || 999999);
  const imagery = await fetchJson(`${ctx.origin}/api/imagery-agent`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      lat: location.latitude,
      lon: location.longitude,
      address: ctx.profile.address,
      leadId: ctx.profile.parcel_id,
      propertyId: ctx.profile.parcel_id,
      lite: rank > 20,
      force,
    }),
  }, 38_000);
  if (!imagery?.dataUrl) throw new Error("imagery_agent_returned_no_usable_image");

  const stored = await latestStoredImage(ctx.db, String(ctx.profile.parcel_id));
  if (!stored?.storage_path) throw new Error("imagery_returned_but_private_storage_missing");

  const captureDate = imagery.capturedDate || null;
  const resolution = imagery.resolution?.[stored.view] || null;
  const record = await persist(ctx.db, {
    parcelId: String(ctx.profile.parcel_id),
    type: "IMAGERY",
    provider: `aerolead_imagery:${imagery.provider || stored.provider || "unknown"}`,
    reality: "REAL_NOW",
    confidence: Math.max(0.45, Math.min(0.98, Number(stored.quality_score || 75) / 100)),
    effectiveAt: captureDate || undefined,
    sourceRef: `${ctx.origin}/api/imagery-agent`,
    payload: {
      storage_path: stored.storage_path,
      mime_type: stored.mime_type || "image/jpeg",
      view: stored.view,
      provider: imagery.provider || stored.provider || null,
      fetched_at: stored.fetched_at || new Date().toISOString(),
      capture_date: captureDate,
      capture_date_status: captureDate ? "provider_verified" : "provider_does_not_expose_capture_date",
      freshness_basis: captureDate ? "provider_capture_date" : "retrieval_timestamp_only",
      resolution,
      notes: Array.isArray(imagery.notes) ? imagery.notes.slice(0, 8) : [],
      analysis_status: "pending",
      damage_analysis_status: "pending",
    },
  });
  return { imagery, stored, record };
}

async function runImageryAnalysis(ctx: NativeContext): Promise<NativeResult> {
  let image = await latestImageryEvidence(ctx.db, String(ctx.profile.parcel_id));
  if (!image?.payload?.storage_path) {
    await acquireImagery(ctx, false);
    image = await latestImageryEvidence(ctx.db, String(ctx.profile.parcel_id));
  }
  if (!image?.payload?.storage_path) throw new Error("imagery_analysis_missing_private_image");

  const downloaded = await ctx.db.storage.from(PROPERTY_IMAGES_BUCKET).download(image.payload.storage_path);
  if (downloaded.error || !downloaded.data) throw new Error(`imagery_download_failed: ${downloaded.error?.message || "no_blob"}`);
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (!bytes.length) throw new Error("imagery_download_empty");

  const analysis = await fetchJson(`${ctx.origin}/api/damage-agent`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      domain: "roof",
      base64Image: bytes.toString("base64"),
      mediaType: image.payload.mime_type || downloaded.data.type || "image/jpeg",
      address: ctx.profile.address,
      leadId: ctx.profile.parcel_id,
      top500: true,
    }),
  }, 38_000);
  if (analysis?.parse_error || analysis?.error) throw new Error(`damage_analysis_invalid: ${analysis?.error || "parse_error"}`);

  const concernScore = Number(analysis.concern_score ?? analysis.score ?? 0);
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const indicators = Array.isArray(analysis.indicators) ? analysis.indicators : [];
  const confidence = confidenceNumber(analysis.confidence, 0.55);
  const payload = {
    ...image.payload,
    analysis_status: "complete",
    damage_analysis_status: "complete",
    analyzed_at: new Date().toISOString(),
    possible_concern_score: Number.isFinite(concernScore) ? Math.max(0, Math.min(100, concernScore)) : 0,
    possible_concerns: findings,
    indicators,
    analysis_notes: analysis.notes || null,
    analysis_provider: analysis.provider || null,
    analysis_confidence: confidence,
    analysis_disclaimer: "Visual findings are possible concerns/opportunities for contractor inspection, not confirmed physical damage.",
    analysis,
  };
  await persist(ctx.db, {
    parcelId: String(ctx.profile.parcel_id),
    type: "IMAGERY",
    provider: `aerolead_vision:${analysis.provider || "vision"}`,
    reality: "REAL_NOW",
    confidence,
    effectiveAt: image.effective_at || undefined,
    sourceRef: `${ctx.origin}/api/damage-agent`,
    payload,
  });

  return { satisfied: true, provider: `aerolead_vision:${analysis.provider || "vision"}`, detail: { concernScore, findings: findings.length, indicators: indicators.length } };
}

async function runIdentity(ctx: NativeContext): Promise<NativeResult> {
  const address = String(ctx.profile?.address || "").trim();
  if (!address) return { satisfied: false, provider: "us_census_geocoder", detail: { reason: "address_missing" } };
  const endpoint = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  endpoint.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" }).toString();
  const response = await fetch(endpoint, { headers: { "user-agent": "AeroLeadAI-Oversight-Superb/1.0" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`census_identity_http_${response.status}`);
  const match = (await response.json())?.result?.addressMatches?.[0];
  if (match) {
    const matchedAddress = String(match.matchedAddress || "");
    const zip = matchedAddress.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] || ctx.profile.zip || null;
    const payload = {
      matched_address: matchedAddress,
      zip,
      latitude: match.coordinates?.y ?? null,
      longitude: match.coordinates?.x ?? null,
      tiger_line_id: match.tigerLine?.tigerLineId || null,
      identity_status: "census_verified",
    };
    await persist(ctx.db, { parcelId: String(ctx.profile.parcel_id), type: "PROPERTY", provider: "us_census_geocoder", reality: "REAL_NOW", confidence: 0.92, sourceRef: "https://geocoding.geo.census.gov/geocoder/", payload });
    if (zip && zip !== ctx.profile.zip) await ctx.db.from("roof_profiles").update({ zip, updated_at: new Date().toISOString() }).eq("parcel_id", ctx.profile.parcel_id);
    return { satisfied: Boolean(zip), provider: "us_census_geocoder", detail: { zip, matched: true } };
  }

  if (ctx.profile?.parcel_id && ctx.profile?.address && ctx.profile?.zip) {
    await persist(ctx.db, {
      parcelId: String(ctx.profile.parcel_id), type: "PROPERTY", provider: "retained_profile_identity", reality: "CACHED_REAL", confidence: 0.85,
      sourceRef: "internal:roof_profiles", payload: { address: ctx.profile.address, zip: ctx.profile.zip, identity_status: "retained_verified_profile" },
    });
    return { satisfied: true, provider: "retained_profile_identity", detail: { censusMatched: false, retained: true } };
  }
  return { satisfied: false, provider: "us_census_geocoder", detail: { censusMatched: false } };
}

async function runPermitHistory(ctx: NativeContext): Promise<NativeResult> {
  const address = String(ctx.profile?.address || "").trim();
  if (!address) return { satisfied: false, provider: "permit_lookup", detail: { reason: "address_missing" } };
  const data = await fetchJson(`${ctx.origin}/api/permit-lookup?address=${encodeURIComponent(address)}`, { headers: internalHeaders() }, 20_000);
  const records = Array.isArray(data.records) ? data.records : [];
  const verifiedSearch = records.length > 0 || data.externalConfigured === true || data.inDirectory === true;
  if (!verifiedSearch) return { satisfied: false, provider: "permit_lookup", detail: { reason: "no_external_permit_source_configured" } };
  const payload = {
    search_result: records.length ? "matching_permit_records" : "no_matching_roofing_permits",
    records: records.slice(0, 100),
    record_count: records.length,
    searched_at: new Date().toISOString(),
    external_configured: data.externalConfigured === true,
    in_directory: data.inDirectory === true,
    notes: data.notes || null,
  };
  await persist(ctx.db, {
    parcelId: String(ctx.profile.parcel_id), type: "PERMIT", provider: "aerolead_permit_lookup", reality: "REAL_NOW", confidence: records.length ? 0.94 : 0.84,
    sourceRef: `${ctx.origin}/api/permit-lookup`, payload,
  });
  return { satisfied: true, provider: "aerolead_permit_lookup", detail: { records: records.length, verifiedNoMatch: records.length === 0 } };
}

function swdiRows(body: any): any[] {
  if (Array.isArray(body)) return body;
  for (const key of ["results", "result", "data", "records", "features"]) if (Array.isArray(body?.[key])) return body[key];
  return [];
}

async function swdiYear(dataset: "plsr" | "nx3hail", year: number, location: { latitude: number; longitude: number }) {
  const latPad = 0.12;
  const lonPad = 0.16;
  const west = location.longitude - lonPad;
  const south = location.latitude - latPad;
  const east = location.longitude + lonPad;
  const north = location.latitude + latPad;
  const range = `${year}0101:${year + 1}0101`;
  const url = `https://www.ncei.noaa.gov/swdiws/json/${dataset}/${range}/250?bbox=${west},${south},${east},${north}`;
  try {
    const response = await fetch(url, { headers: { "user-agent": "AeroLeadAI-Oversight-Superb/1.0" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) return [];
    return swdiRows(await response.json()).map((row: any) => ({ ...row, dataset, query_year: year }));
  } catch {
    return [];
  }
}

async function runWeatherHistory(ctx: NativeContext): Promise<NativeResult> {
  const location = coords(ctx.profile, ctx.structure);
  if (!location) return { satisfied: false, provider: "noaa_swdi", detail: { reason: "coordinates_missing" } };
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: WEATHER_LOOKBACK_YEARS }, (_, index) => currentYear - index);
  const queries = years.flatMap(year => [swdiYear("plsr", year, location), swdiYear("nx3hail", year, location)]);
  const resultSets = await Promise.all(queries);
  const rows = resultSets.flat();
  const eventRows = rows.filter((row: any) => {
    const text = `${row.event || row.EVENT || row.EVENT_TYPE || ""} ${row.type || ""}`.toLowerCase();
    return row.dataset === "nx3hail" || /hail|wind|tornado|thunderstorm/.test(text);
  });
  const payload = {
    search_result: eventRows.length ? "severe_weather_signals_found" : "no_swdi_signals_in_search_area",
    source: "NOAA/NCEI Severe Weather Data Inventory",
    lookback_years: WEATHER_LOOKBACK_YEARS,
    search_radius_note: "Approximate local bounding box around verified property coordinates.",
    events: eventRows.slice(0, 150),
    event_count: eventRows.length,
    searched_at: new Date().toISOString(),
    no_event_caveat: "Absence of SWDI records does not prove no severe weather occurred; it means no qualifying record was returned for this search area/window.",
  };
  await persist(ctx.db, {
    parcelId: String(ctx.profile.parcel_id), type: "WEATHER", provider: "noaa_swdi", reality: "REAL_NOW", confidence: eventRows.length ? 0.88 : 0.72,
    sourceRef: "https://www.ncei.noaa.gov/products/severe-weather-data-inventory", payload,
  });
  return { satisfied: true, provider: "noaa_swdi", detail: { eventCount: eventRows.length, lookbackYears: WEATHER_LOOKBACK_YEARS } };
}

export async function runNativeRequirement(ctx: NativeContext): Promise<NativeResult> {
  switch (ctx.requirement) {
    case "identity": return runIdentity(ctx);
    case "permit_history": return runPermitHistory(ctx);
    case "weather_history": return runWeatherHistory(ctx);
    case "imagery_capture": {
      const result = await acquireImagery(ctx, false);
      return { satisfied: true, provider: String(result.record.provider), detail: { storagePath: result.stored.storage_path, provider: result.imagery.provider || null } };
    }
    case "imagery_date": {
      let image = await latestImageryEvidence(ctx.db, String(ctx.profile.parcel_id));
      if (!image?.payload?.storage_path) {
        await acquireImagery(ctx, false);
        image = await latestImageryEvidence(ctx.db, String(ctx.profile.parcel_id));
      }
      const status = image?.payload?.capture_date_status;
      return {
        satisfied: Boolean(image?.payload?.capture_date || image?.effective_at || status === "provider_does_not_expose_capture_date"),
        provider: String(image?.provider || "aerolead_imagery"),
        detail: { captureDate: image?.payload?.capture_date || image?.effective_at || null, captureDateStatus: status || "unknown" },
      };
    }
    case "imagery_analysis": return runImageryAnalysis(ctx);
    default: return { satisfied: false, provider: "native_worker", detail: { reason: "unsupported_requirement" } };
  }
}
