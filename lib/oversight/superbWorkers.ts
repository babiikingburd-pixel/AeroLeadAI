import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseEvidenceCache } from "./cache";
import { makeEvidence } from "./evidence";
import { runNativeRequirement, supportsNativeRequirement } from "./nativeWorkers";

export { supportsNativeRequirement };

type Context = {
  db: SupabaseClient;
  origin: string;
  profile: any;
  structure?: any;
  requirement: string;
};

type Result = {
  satisfied: boolean;
  provider: string;
  detail?: Record<string, unknown>;
};

type SwdiResult = { ok: boolean; rows: any[]; status?: number; error?: string };
const LOOKBACK_YEARS = 10;

function coords(profile: any, structure: any) {
  const latitude = Number(structure?.latitude ?? profile?.latitude ?? profile?.lat);
  const longitude = Number(structure?.longitude ?? profile?.longitude ?? profile?.lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function ymd(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function swdiRows(body: any): any[] {
  if (Array.isArray(body)) return body;
  for (const key of ["results", "result", "data", "records", "features"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

async function swdiYear(dataset: "plsr" | "nx3hail", year: number, location: { latitude: number; longitude: number }): Promise<SwdiResult> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const start = `${year}0101`;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  const end = year === currentYear ? ymd(tomorrow) : `${year + 1}0101`;
  const west = location.longitude - 0.16;
  const south = location.latitude - 0.12;
  const east = location.longitude + 0.16;
  const north = location.latitude + 0.12;
  const url = `https://www.ncei.noaa.gov/swdiws/json/${dataset}/${start}:${end}/250?bbox=${west},${south},${east},${north}`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "AeroLeadAI-Oversight-Superb/1.1" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, rows: [], status: response.status, error: `http_${response.status}` };
    const body = await response.json().catch(() => null);
    if (body === null) return { ok: false, rows: [], status: response.status, error: "invalid_json" };
    return { ok: true, rows: swdiRows(body).map((row: any) => ({ ...row, dataset, query_year: year })) };
  } catch (error) {
    return { ok: false, rows: [], error: error instanceof Error ? error.message : "request_failed" };
  }
}

async function strictWeather(ctx: Context): Promise<Result> {
  const location = coords(ctx.profile, ctx.structure);
  if (!location) return { satisfied: false, provider: "noaa_swdi", detail: { reason: "coordinates_missing" } };
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: LOOKBACK_YEARS }, (_, index) => currentYear - index);
  const results = await Promise.all(years.flatMap(year => [swdiYear("plsr", year, location), swdiYear("nx3hail", year, location)]));
  const failures = results.filter(result => !result.ok);
  if (failures.length) {
    throw new Error(`noaa_swdi_partial_failure_${failures.length}_of_${results.length}`);
  }

  const rows = results.flatMap(result => result.rows);
  const events = rows.filter((row: any) => {
    const text = `${row.event || row.EVENT || row.EVENT_TYPE || ""} ${row.type || ""}`.toLowerCase();
    return row.dataset === "nx3hail" || /hail|wind|tornado|thunderstorm/.test(text);
  });
  const payload = {
    search_result: events.length ? "severe_weather_signals_found" : "no_swdi_signals_in_search_area",
    source: "NOAA/NCEI Severe Weather Data Inventory",
    lookback_years: LOOKBACK_YEARS,
    query_count: results.length,
    successful_queries: results.length,
    failed_queries: 0,
    search_status: "complete",
    search_radius_note: "Approximate local bounding box around verified property coordinates.",
    events: events.slice(0, 150),
    event_count: events.length,
    searched_at: new Date().toISOString(),
    no_event_caveat: "Absence of SWDI records does not prove no severe weather occurred; it means no qualifying record was returned for this search area/window.",
  };
  const record = makeEvidence({
    parcelId: String(ctx.profile.parcel_id),
    type: "WEATHER",
    provider: "noaa_swdi",
    reality: "REAL_NOW",
    confidence: events.length ? 0.88 : 0.72,
    sourceRef: "https://www.ncei.noaa.gov/products/severe-weather-data-inventory",
    payload,
  });
  await new SupabaseEvidenceCache(ctx.db).persist([record]);
  return { satisfied: true, provider: "noaa_swdi", detail: { eventCount: events.length, lookbackYears: LOOKBACK_YEARS, queryCount: results.length } };
}

async function resolvedImageryDate(ctx: Context): Promise<Result> {
  let dateResult = await runNativeRequirement({ ...ctx, requirement: "imagery_date" });
  if (dateResult.satisfied) return dateResult;
  const capture = await runNativeRequirement({ ...ctx, requirement: "imagery_capture" });
  if (!capture.satisfied) return capture;
  dateResult = await runNativeRequirement({ ...ctx, requirement: "imagery_date" });
  return dateResult;
}

export async function runSuperbRequirement(ctx: Context): Promise<Result> {
  if (ctx.requirement === "weather_history") return strictWeather(ctx);
  if (ctx.requirement === "imagery_date") return resolvedImageryDate(ctx);
  if (ctx.requirement === "imagery_analysis") {
    const dateResult = await resolvedImageryDate(ctx);
    if (!dateResult.satisfied) return dateResult;
    return runNativeRequirement({ ...ctx, requirement: "imagery_analysis" });
  }
  return runNativeRequirement(ctx);
}
