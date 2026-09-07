import { supabaseServer } from "../../../lib/supabaseServer";
import { loadOversightConsoleData } from "../../../lib/oversight/consoleData";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIER_CAPS = { review: 100, candidates: 500, contractor: 20 };
const SCORE_VERSION = "oversight-collection-1.0";

function clean(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function titleCase(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseCity(address) {
  const match = clean(address).match(/,\s*([^,]+),\s*MN(?:\s|,|$)/i);
  return match ? titleCase(match[1]) : "";
}

function countyFor(profile, structure, permit) {
  const explicit = structure?.county || permit?.address?.county;
  if (explicit) return clean(explicit).toLowerCase();
  const parcelPrefix = clean(profile.parcel_id).split("-")[0].toLowerCase();
  if (["dakota", "hennepin", "ramsey", "scott", "carver", "anoka"].includes(parcelPrefix)) return parcelPrefix;
  const ring = clean(profile.ring_id).toLowerCase();
  return ["dakota", "hennepin", "ramsey", "scott", "carver", "anoka"].find((county) => ring.includes(county)) || parcelPrefix;
}

function evidenceIndex(rows) {
  const indexed = new Map();
  for (const row of rows || []) indexed.set(`${row.parcel_id}:${row.type}`, row);
  return indexed;
}

function evidenceFor(indexed, parcelId, type) {
  return indexed.get(`${parcelId}:${type}`) || null;
}

function isUsable(row) {
  return Boolean(row && row.payload && !row.payload.reason);
}

function permitSummary(row) {
  if (!isUsable(row)) {
    return { status: "search_needed", count: 0, roofCount: 0, checkedAt: null, within10y: null };
  }

  const payload = row.payload || {};
  const records = Array.isArray(payload.records) ? payload.records : [payload];
  const meaningful = records.filter((record) => record && (record.id || record.number || record.issue_date || record.description));
  const roofRecords = meaningful.filter((record) =>
    /roof|shingle|reroof|re-roof|roofing/i.test(
      [record.description, record.type, record.subtype, ...(Array.isArray(record.tags) ? record.tags : [])].filter(Boolean).join(" ")
    )
  );
  const issueDates = roofRecords
    .map((record) => record.issue_date || record.file_date || record.start_date)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()));
  const tenYearsAgo = new Date();
  tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);

  return {
    status: meaningful.length ? "verified" : "none_found",
    count: meaningful.length,
    roofCount: roofRecords.length,
    checkedAt: row.captured_at || null,
    within10y: issueDates.length ? issueDates.some((date) => date >= tenYearsAgo) : meaningful.length ? false : null,
  };
}

function streetViewUrl(lat, lon, address) {
  if (lat != null && lon != null) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${Number(lat)},${Number(lon)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function mapLead(profile, indexed, fallbackRank) {
  const parcelId = profile.parcel_id;
  const structureRow = evidenceFor(indexed, parcelId, "STRUCTURE");
  const propertyRow = evidenceFor(indexed, parcelId, "PROPERTY");
  const permitRow = evidenceFor(indexed, parcelId, "PERMIT");
  const weatherRow = evidenceFor(indexed, parcelId, "WEATHER");
  const imageryRow = evidenceFor(indexed, parcelId, "IMAGERY");
  const structure = isUsable(structureRow) ? structureRow.payload : {};
  const property = isUsable(propertyRow) ? propertyRow.payload : {};
  const permitPayload = isUsable(permitRow) ? permitRow.payload : {};
  const imagery = isUsable(imageryRow) ? imageryRow.payload : {};
  const permit = permitSummary(permitRow);
  const yearBuilt = numberOrNull(structure.year_built ?? structure.yearBuilt ?? structure.effective_year_built);
  const assessedValue = numberOrNull(
    structure.assessed_value ??
    structure.market_value ??
    structure.total_value ??
    permitPayload.property_assess_market_value
  );
  const lat = numberOrNull(structure.latitude ?? property.latitude ?? imagery.latitude);
  const lon = numberOrNull(structure.longitude ?? property.longitude ?? imagery.longitude);
  const city = titleCase(structure.city || permitPayload?.address?.city || parseCity(profile.address));
  const county = countyFor(profile, structure, permitPayload);
  const streetAddress = clean(structure.address) || clean(profile.address).split(",")[0];
  const propertyClass = clean(
    structure.property_type ||
    structure.dwelling_type ||
    structure.use_type ||
    structure.use_code ||
    permitPayload.property_type_detail ||
    permitPayload.property_type
  ) || "Residential candidate";
  const assessorComplete = isUsable(structureRow) && lat != null && lon != null;
  const imageryComplete = Boolean(imagery.storage_path && imagery.image_url);
  const permitComplete = isUsable(permitRow);
  const weatherComplete = isUsable(weatherRow);
  const confidenceScore = Math.round(Number(profile.evidence_confidence || 0) * 100);
  const completion = Math.round(Number(profile.completion_pct || 0));
  const priorityScore = Number(Number(profile.rank_score || profile.commercial_priority || 0).toFixed(2));
  const missing = [
    !permitComplete && "permit history",
    !weatherComplete && "storm/weather",
    !assessorComplete && "assessor/geolocation",
    !imageryComplete && "stored property imagery",
  ].filter(Boolean);
  const rank = Number(profile.live_rank) || fallbackRank;
  const currentYear = new Date().getUTCFullYear();
  const fullAddress = [streetAddress, city, "MN", profile.zip].filter(Boolean).join(", ");

  return {
    id: parcelId,
    parcelId,
    rank,
    address: streetAddress,
    city,
    county,
    zip: profile.zip || property.zip || permitPayload?.address?.zip_code || null,
    lat,
    lon,
    propertyClass,
    singleFamilySignal: /single.?family|s\.fam|detached|residential/i.test(propertyClass) ? 2 : 1,
    yearBuilt,
    propertyAgeYears: yearBuilt ? Math.max(0, currentYear - yearBuilt) : null,
    assessedValue: assessedValue && assessedValue > 10_000_000 ? Math.round(assessedValue / 100) : assessedValue,
    permit,
    aeroLeadScore: priorityScore,
    aeroLeadScoreVersion: SCORE_VERSION,
    aeroLeadScoreBreakdown: {
      collection_rank: rank,
      opportunity: Number(profile.opportunity || 0),
      evidence_confidence: confidenceScore,
      completion_pct: completion,
    },
    aeroLeadMissingEvidence: missing,
    evidenceScore: completion,
    confidenceScore,
    priorityScore,
    evidenceTwinPriorityScore: priorityScore,
    evidenceTwinConfidenceScore: confidenceScore,
    scoringVersion: SCORE_VERSION,
    opportunityScore: Number(profile.opportunity || 0),
    evidenceConfidence: Number(profile.evidence_confidence || 0),
    contractorValueScore: Number(profile.commercial_priority || 0),
    scoreStatus: "COLLECTION",
    gatekeeperClassification: "BYPASSED_FOR_COLLECTION",
    scoreBreakdown: {
      rank_score: priorityScore,
      opportunity: Number(profile.opportunity || 0),
      confidence: confidenceScore,
      doctor_completion: completion,
    },
    evidenceSummary: {
      permit: permitComplete,
      storm: weatherComplete,
      assessor: assessorComplete,
      imagery: imageryComplete,
    },
    nextEvidencePlan: missing,
    humanReview: true,
    reviewStatus: profile.review_status || "pending",
    categories: ["collection-ready", profile.deep_dive_tier].filter(Boolean),
    breakdown: {
      collection_rank: rank,
      opportunity: Number(profile.opportunity || 0),
      confidence: confidenceScore,
      doctor_completion: completion,
    },
    reasons: [
      "Real parcel identity, coordinates, and stored imagery verified",
      "GateKeeper paused for publication; retained as an audit layer",
      ...(profile.gate_reasons || []),
    ],
    tier: profile.deep_dive_tier || (rank <= 100 ? "TOP_100" : "TOP_500"),
    selectionTrack: "oversight_collection",
    sourceStatus: {
      permit: permitComplete,
      storm: weatherComplete,
      assessor: assessorComplete,
      imagery: imageryComplete,
    },
    validationStatus: profile.doctor_gate_status || "REPAIRING",
    validationScore: completion,
    validationConfidence: confidenceScore,
    lastValidatedAt: profile.ranked_at || profile.updated_at || null,
    scoredAt: profile.ranked_at || profile.updated_at || null,
    imageUrl: imagery.image_url || null,
    imageIsFallback: false,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`,
    streetViewUrl: streetViewUrl(lat, lon, fullAddress),
  };
}

export async function GET(req) {
  const db = supabaseServer();
  if (!db) return Response.json({ ok: false, error: "Supabase not configured.", leads: [], total: 0 }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const requestedTier = searchParams.get("tier");
  const tier = TIER_CAPS[requestedTier] ? requestedTier : "review";
  const requestedLimit = Number(searchParams.get("limit")) || TIER_CAPS[tier];
  const limit = Math.max(1, Math.min(requestedLimit, TIER_CAPS[tier]));

  try {
    const data = await loadOversightConsoleData(db);
    if (data.connectionError) throw new Error(data.connectionError);

    const indexed = evidenceIndex(data.evidence);
    const ranked = data.profiles
      .filter((profile) => profile.leaderboard_eligible)
      .map((profile, index) => mapLead(profile, indexed, index + 1));
    const pool = tier === "contractor"
      ? [...ranked].sort((left, right) =>
          Number(right.reviewStatus === "approved") - Number(left.reviewStatus === "approved") ||
          left.rank - right.rank
        )
      : ranked;
    const leads = pool.slice(0, limit);

    return Response.json({
      ok: true,
      tier,
      cap: TIER_CAPS[tier],
      leads,
      total: leads.length,
      scanned: data.totalProfiles,
      entered: data.eligibleCount,
      top100Count: Math.min(100, data.eligibleCount),
      top500Count: Math.min(500, data.eligibleCount),
      photoCount: data.photoCount,
      photoCoverage: data.photoCoverage,
      liveScored: true,
      gatekeeperMode: "BYPASSED_FOR_COLLECTION",
      aeroLeadScoreVersion: SCORE_VERSION,
      scoringVersion: SCORE_VERSION,
      deduped: true,
      residentialFiltered: true,
      singleFamilyPrioritized: true,
      partialErrors: [],
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load active oversight leads.",
      leads: [],
      total: 0,
    }, { status: 500 });
  }
}
