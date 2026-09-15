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

async function latestImageryEvidence(db: SupabaseClient, parcelId: string) {
  const { data, error } = await db
    .from("evidence_records")
    .select("payload,provider,reality,confidence,effective_at,captured_at,source_ref")
    .eq("parcel_id", parcelId)
    .eq("type", "IMAGERY")
    .in("reality", ["REAL_NOW", "CACHED_REAL"])
    .order("captured_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`imagery_evidence_read_failed: ${error.message}`);
  return (data || []).find((row: any) => row.payload?.storage_path) || null;
}

function providerDoesNotExposeCaptureDate(image: any) {
  const provider = `${image?.provider || ""} ${image?.payload?.provider || ""}`.toLowerCase();
  return ["esri", "world imagery", "google", "mapbox", "nearmap"].some((name) => provider.includes(name));
}

async function recordCaptureDateLimitation(ctx: NativeContext, image: any) {
  if (!image?.payload?.storage_path || !providerDoesNotExposeCaptureDate(image)) return image;
  const payload = {
    ...image.payload,
    capture_date: null,
    capture_date_status: "provider_does_not_expose_capture_date",
    freshness_basis: "retrieval_timestamp_only",
  };
  return persist(ctx.db, {
    parcelId: String(ctx.profile.parcel_id),
    type: "IMAGERY",
    provider: String(image.provider || "aerolead_imagery"),
    reality: image.reality === "CACHED_REAL" ? "CACHED_REAL" : "REAL_NOW",
    confidence: confidenceNumber(image.confidence, 0.72),
    sourceRef: image.source_ref || undefined,
    payload,
  });
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

  const existing = await latestImageryEvidence(ctx.db, String(ctx.profile.parcel_id));
  const stored = imagery?.stored?.preferred || (existing?.payload?.storage_path ? {
    storage_path: existing.payload.storage_path,
    mime_type: existing.payload.mime_type,
    view: existing.payload.view || existing.payload.image_role || "overview_tight",
    provider: existing.payload.provider || existing.provider,
    fetched_at: existing.payload.fetched_at || existing.captured_at,
    quality_score: Number(existing.confidence || 0.72) * 100,
  } : null);
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

const NOAA_STORM_EVENTS_URL = "https://www.ncei.noaa.gov/access/storm-events-database/api/search-events";
const NOAA_EVENT_TYPES = ["Hail", "High Wind", "Strong Wind", "Thunderstorm Wind", "Tornado"];
const NOAA_CACHE_TTL_MS = 30 * 60_000;
const noaaCountyCache = new Map<string, { expiresAt: number; request: Promise<any[]> }>();
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function weatherGeography(ctx: NativeContext) {
  const addressState = String(ctx.profile?.address || "").match(/,\s*([A-Z]{2})(?:\s+\d{5})?\s*$/i)?.[1];
  const rawState = String(ctx.structure?.state_abbreviation || ctx.structure?.state || addressState || "MN").toUpperCase();
  const state = STATE_NAMES[rawState] || (Object.values(STATE_NAMES).includes(rawState) ? titleCase(rawState) : null);
  const parcelCounty = String(ctx.profile?.parcel_id || "").split("-")[0];
  const rawCounty = String(ctx.structure?.county || ctx.structure?.county_name || ctx.profile?.county || parcelCounty || "");
  const county = titleCase(rawCounty.replace(/\s+(county|co\.?)$/i, "").trim());
  return state && county ? { state, county } : null;
}

async function searchNoaaStormEvents(state: string, county: string, beginDate: string, endDate: string) {
  const key = `${state}:${county}:${beginDate}:${endDate}`;
  const cached = noaaCountyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = (async () => {
    const response = await fetch(NOAA_STORM_EVENTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "AeroLeadAI-Oversight-Superb/1.2" },
      body: JSON.stringify({
        activeTab: 1,
        stateList: [state],
        countyList: [county],
        eventList: NOAA_EVENT_TYPES,
        beginDate,
        endDate,
        onThisDay: false,
      }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`noaa_storm_events_http_${response.status}`);
    if (!body || body.error) {
      const message = body?.error?.title || body?.error?.content || "provider_error";
      throw new Error(`noaa_storm_events_error: ${String(message).slice(0, 160)}`);
    }
    if (!Array.isArray(body.data)) throw new Error("noaa_storm_events_invalid_response");
    return body.data;
  })();

  noaaCountyCache.set(key, { expiresAt: Date.now() + NOAA_CACHE_TTL_MS, request });
  try {
    return await request;
  } catch (error) {
    noaaCountyCache.delete(key);
    throw error;
  }
}

async function runWeatherHistory(ctx: NativeContext): Promise<NativeResult> {
  const location = coords(ctx.profile, ctx.structure);
  if (!location) return { satisfied: false, provider: "noaa_ncei_storm_events", detail: { reason: "coordinates_missing" } };
  const geography = weatherGeography(ctx);
  if (!geography) return { satisfied: false, provider: "noaa_ncei_storm_events", detail: { reason: "state_or_county_missing" } };
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() - 3);
  const begin = new Date(end);
  begin.setUTCFullYear(begin.getUTCFullYear() - WEATHER_LOOKBACK_YEARS);
  const beginDate = isoDate(begin);
  const endDate = isoDate(end);
  const eventRows = await searchNoaaStormEvents(geography.state, geography.county, beginDate, endDate);
  const storedEvents = eventRows.slice(0, 40);
  const payload = {
    search_result: eventRows.length ? "severe_weather_events_found" : "no_matching_storm_events_in_county_window",
    source: "NOAA/NCEI Storm Events Database",
    geography_scope: "county",
    state: geography.state,
    county: geography.county,
    lookback_years: WEATHER_LOOKBACK_YEARS,
    begin_date: beginDate,
    end_date: endDate,
    event_types: NOAA_EVENT_TYPES,
    query_count: 1,
    successful_queries: 1,
    failed_queries: 0,
    search_status: "complete",
    search_scope_note: "County-level NOAA records linked to a property with verified coordinates; events are corroborating territory evidence, not proof of parcel impact.",
    property_coordinates: location,
    events: storedEvents,
    event_count: eventRows.length,
    events_in_payload: storedEvents.length,
    event_sample_truncated: eventRows.length > storedEvents.length,
    searched_at: new Date().toISOString(),
    no_event_caveat: "A no-match result means no qualifying county record was returned for this bounded search; it does not prove that no severe weather affected the parcel.",
  };
  await persist(ctx.db, {
    parcelId: String(ctx.profile.parcel_id), type: "WEATHER", provider: "noaa_ncei_storm_events", reality: "REAL_NOW", confidence: eventRows.length ? 0.86 : 0.70,
    sourceRef: "https://www.ncei.noaa.gov/access/storm-events-database", payload,
  });
  return {
    satisfied: true,
    provider: "noaa_ncei_storm_events",
    detail: { eventCount: eventRows.length, lookbackYears: WEATHER_LOOKBACK_YEARS, geography: `${geography.county} County, ${geography.state}` },
  };
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
      if (
        image?.payload?.storage_path
        && !image?.payload?.capture_date
        && !image?.effective_at
        && !image?.payload?.capture_date_status
      ) {
        image = await recordCaptureDateLimitation(ctx, image);
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
