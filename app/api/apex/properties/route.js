import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_LIMIT = 500;
const REALITIES = ["REAL_NOW", "CACHED_REAL"];
const EVIDENCE_TYPES = ["IMAGERY", "PERMIT", "WEATHER", "STRUCTURE", "PROPERTY"];

export async function GET(request) {
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") || 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), MAX_LIMIT))
    : 100;
  const db = supabaseServer();

  if (!db) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured in this environment.", properties: [], count: 0 },
      { status: 503 }
    );
  }

  const profilesResult = await db
    .from("roof_profiles")
    .select(
      "parcel_id,address,zip,opportunity,evidence_confidence,commercial_priority,contradictions,corroborations,completion_pct,deep_dive_tier,live_rank,rank_score,review_status,human_review_notes",
      { count: "exact" }
    )
    .eq("leaderboard_eligible", true)
    .order("live_rank", { ascending: true, nullsFirst: false })
    .order("rank_score", { ascending: false })
    .limit(limit);

  if (profilesResult.error) {
    return NextResponse.json(
      { ok: false, error: profilesResult.error.message, properties: [], count: 0 },
      { status: 502 }
    );
  }

  const profiles = profilesResult.data || [];
  const parcelIds = profiles.map((profile) => profile.parcel_id).filter(Boolean);
  let evidence = [];

  if (parcelIds.length) {
    const evidenceResult = await db
      .from("evidence_records")
      .select("parcel_id,type,provider,reality,captured_at,effective_at,confidence,payload,content_hash")
      .in("parcel_id", parcelIds)
      .in("type", EVIDENCE_TYPES)
      .in("reality", REALITIES)
      .order("captured_at", { ascending: false })
      .limit(3000);

    if (evidenceResult.error) {
      return NextResponse.json(
        { ok: false, error: evidenceResult.error.message, properties: [], count: 0 },
        { status: 502 }
      );
    }
    evidence = evidenceResult.data || [];
  }

  const latest = latestUsableEvidence(evidence);
  const properties = profiles.map((profile, index) => shapeProperty(profile, latest, index));
  const territory = [...new Set(properties.map((property) => property.county && `${property.county}, ${property.state}`).filter(Boolean))];

  const top100Result = await db
    .from("roof_profiles")
    .select("parcel_id", { count: "exact", head: true })
    .eq("leaderboard_eligible", true)
    .gt("live_rank", 0)
    .lte("live_rank", 100);
  const top500Result = await db
    .from("roof_profiles")
    .select("parcel_id", { count: "exact", head: true })
    .eq("leaderboard_eligible", true)
    .gt("live_rank", 0)
    .lte("live_rank", 500);

  return NextResponse.json({
    ok: true,
    source: "AeroLeadAI Oversight · roof_profiles + verified evidence",
    generatedAt: new Date().toISOString(),
    territory: territory.length ? territory : ["Current ranked territory"],
    totalEligible: profilesResult.count ?? properties.length,
    top100Count: top100Result.error ? null : (top100Result.count ?? 0),
    top500Count: top500Result.error ? null : (top500Result.count ?? 0),
    loadedLimit: limit,
    count: properties.length,
    properties,
  });
}
function latestUsableEvidence(rows) {
  const latest = new Map();
  for (const row of rows) {
    const key = `${row.parcel_id}:${row.type}`;
    const current = latest.get(key);
    if (!current || (!usableEvidence(current) && usableEvidence(row))) latest.set(key, row);
  }
  return latest;
}

function usableEvidence(row) {
  const payload = row?.payload || {};
  if (payload.reason || payload.error) return false;
  if (row.type === "IMAGERY") return Boolean(payload.storage_path);
  return Object.keys(payload).length > 0;
}

function shapeProperty(profile, evidence, index) {
  const parcelId = String(profile.parcel_id);
  const structure = evidence.get(`${parcelId}:STRUCTURE`);
  const propertyEvidence = evidence.get(`${parcelId}:PROPERTY`);
  const imagery = evidence.get(`${parcelId}:IMAGERY`);
  const weather = evidence.get(`${parcelId}:WEATHER`);
  const permit = evidence.get(`${parcelId}:PERMIT`);
  const structurePayload = structure?.payload || {};
  const propertyPayload = propertyEvidence?.payload || {};
  const location = parseLocation(profile.address, structurePayload, propertyPayload, parcelId);
  const yearBuilt = integerOrNull(
    structurePayload.year_built ?? structurePayload.yearBuilt ?? structurePayload.effective_year_built
  );
  const stormExposure = summarizeStormEvidence(weather?.payload);
  const rank = integerOrNull(profile.live_rank);
  const score = numberOrNull(profile.rank_score ?? profile.opportunity ?? profile.commercial_priority);
  const evidenceConfidence = numberOrNull(profile.evidence_confidence);

  return {
    id: parcelId,
    address: location.street,
    city: location.city,
    state: location.state,
    zip: profile.zip || propertyPayload.zip || null,
    county: location.county,
    lat: numberOrNull(structurePayload.latitude ?? propertyPayload.latitude),
    lon: numberOrNull(structurePayload.longitude ?? propertyPayload.longitude),
    score: score == null ? null : Math.round(score),
    scoreBasis: "Current live rank score",
    confidence: evidenceConfidence == null
      ? null
      : Math.round((evidenceConfidence <= 1 ? evidenceConfidence * 100 : evidenceConfidence) * 10) / 10,
    evidenceCompleteness: numberOrNull(profile.completion_pct),
    tier: rankTier(rank),
    rank,
    displayIndex: index + 1,
    yearBuilt,
    structureAge: yearBuilt ? new Date().getUTCFullYear() - yearBuilt : null,
    roofAgeEstimate: yearBuilt
      ? `${new Date().getUTCFullYear() - yearBuilt} years since construction; roof age is not directly observed`
      : "Unknown — construction year is not on record",
    assessedValue: numberOrNull(structurePayload.assessed_value ?? structurePayload.assessedValue),
    stormExposure,
    permit: {
      status: permit?.payload?.search_result || (permit ? "search_complete" : "pending"),
      historyCount: permitCount(permit?.payload),
      provider: permit?.provider || null,
    },
    imagery: imagery?.payload?.storage_path
      ? {
          source: imagery.provider,
          status: "ready",
          url: `/api/oversight/image/${encodeURIComponent(parcelId)}?v=${encodeURIComponent(String(imagery.content_hash || imagery.captured_at || "current").slice(0, 16))}`,
          attribution: imagery.payload.provider || imagery.provider,
          captureDate: imagery.payload.capture_date || imagery.effective_at || null,
          captureDateStatus: imagery.payload.capture_date_status || null,
        }
      : { source: "none", status: "unavailable", url: null, attribution: "No private image on record" },
    review: ["needs_review", "flagged"].includes(String(profile.review_status || "").toLowerCase())
      || Boolean(profile.human_review_notes)
      || (Array.isArray(profile.contradictions) && profile.contradictions.length > 0),
    reviewStatus: profile.review_status || "pending",
    reasons: [
      ...(Array.isArray(profile.corroborations)
        ? profile.corroborations.map((label) => ({ label: String(label), kind: "corroboration" }))
        : []),
      ...(Array.isArray(profile.contradictions)
        ? profile.contradictions.map((label) => ({ label: String(label), kind: "contradiction" }))
        : []),
    ],
  };
}

function parseLocation(address, structure, propertyEvidence, parcelId) {
  const parts = String(address || "").split(",").map((part) => part.trim()).filter(Boolean);
  const matchedParts = String(propertyEvidence.matched_address || "").split(",").map((part) => part.trim()).filter(Boolean);
  const street = parts[0] || structure.address || matchedParts[0] || "Address unavailable";
  const city = structure.city || parts[1] || matchedParts[1] || "City unavailable";
  const state = normalizeState(parts[2] || matchedParts[2] || structure.state || "MN");
  const rawCounty = structure.county || structure.county_name || propertyEvidence.county
    || String(parcelId || "").split("-")[0]
    || "Dakota";
  const county = titleCase(String(rawCounty).replace(/\s+(county|co\.?$)/i, "").trim()) || "Dakota";
  return { street, city: titleCase(city), state, county };
}

function normalizeState(value) {
  const state = String(value || "").trim().toUpperCase();
  if (state === "MINNESOTA") return "MN";
  return /^[A-Z]{2}$/.test(state) ? state : "MN";
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number == null ? null : Math.trunc(number);
}

function rankTier(rank) {
  if (!rank) return "unranked";
  if (rank <= 20) return "top20";
  if (rank <= 100) return "top100";
  if (rank <= 500) return "top500";
  return "ranked";
}

function permitCount(payload = {}) {
  if (Array.isArray(payload.records)) return payload.records.length;
  return integerOrNull(payload.record_count);
}

function summarizeStormEvidence(payload = {}) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  let hailInches = null;
  let windMph = null;
  let stormDate = null;

  for (const event of events) {
    const type = String(event.event_type || event.EVENT_TYPE || event.event || event.type || "").toLowerCase();
    const magnitude = String(event.magnitude || event.MAGNITUDE || "");
    const value = Number.parseFloat(magnitude);
    if (/hail/.test(type) && Number.isFinite(value)) hailInches = Math.max(hailInches || 0, value);
    if (/wind|thunderstorm/.test(type) && Number.isFinite(value)) {
      const mph = /kt|knot/i.test(magnitude) ? value * 1.15078 : value;
      windMph = Math.max(windMph || 0, mph);
    }
    if (!stormDate) {
      stormDate = event.begin_date_time_formatted || event.BEGIN_DATE_TIME || event.date || null;
    }
  }

  const eventCount = integerOrNull(payload.event_count) ?? events.length;
  const geography = payload.county && payload.state ? `${payload.county} County, ${payload.state}` : null;
  return {
    hailInches: hailInches == null ? null : Math.round(hailInches * 100) / 100,
    windMph: windMph == null ? null : Math.round(windMph),
    stormDate,
    eventCount,
    scope: payload.geography_scope || null,
    label: payload.search_status === "complete"
      ? `${eventCount} NOAA severe-weather event${eventCount === 1 ? "" : "s"} in the bounded ${geography || "territory"} search`
      : "Storm-history search pending",
  };
}
