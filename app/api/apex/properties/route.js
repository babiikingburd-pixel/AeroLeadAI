import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { eagleViewConfigured, eagleViewConfig } from "../../../../lib/eagleview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_CONTRACTOR = "apex roofing";

/**
 * Real Apex property grid.
 *
 * HARD RULES (do not relax):
 *  - No demo/sample/placeholder properties. Ever. If the DB returns nothing,
 *    this route returns an empty list and says so.
 *  - No derived value is presented as observed. Roof age is computed from
 *    year_built and labelled as an estimate; damage risk is derived from
 *    recorded storm exposure and labelled as exposure, not confirmed damage.
 *  - Imagery is always attributed to its real source. If EagleView imagery
 *    has not been fetched for a property, we say "pending" and fall back to
 *    Esri World Imagery, labelled as Esri — never labelled as EagleView.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const contractorName = (url.searchParams.get("contractor") || DEFAULT_CONTRACTOR).trim();
  const limit = Math.min(Number(url.searchParams.get("limit") || 24), 100);

  const supabase = supabaseServer();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase is not configured in this environment.",
        properties: [],
        count: 0,
      },
      { status: 503 }
    );
  }

  const { data: contractor, error: contractorError } = await supabase
    .from("contractor_candidates")
    .select("id, business_name, city, state, service_area_cities, prospect_score")
    .ilike("business_name", contractorName)
    .limit(1)
    .maybeSingle();

  if (contractorError) {
    return NextResponse.json(
      { ok: false, error: contractorError.message, properties: [], count: 0 },
      { status: 500 }
    );
  }

  if (!contractor) {
    return NextResponse.json(
      {
        ok: false,
        error: `No contractor named "${contractorName}" is registered.`,
        properties: [],
        count: 0,
      },
      { status: 404 }
    );
  }

  const cities = Array.isArray(contractor.service_area_cities)
    ? contractor.service_area_cities.filter(Boolean)
    : [];

  if (cities.length === 0) {
    return NextResponse.json({
      ok: true,
      contractor: publicContractor(contractor),
      properties: [],
      count: 0,
      note: "This contractor has no configured service area, so no territory can be scored.",
    });
  }

  const { data: rows, error: leadError } = await supabase
    .from("batch_leads")
    .select(
      [
        "id","address","city","zip","county","lat","lon","year_built",
        "assessed_value","assessed_year","priority_score","confidence_score",
        "evidence_confidence","evidence_completeness","apex_tier","apex_rank",
        "top500_rank","hail_inches","wind_mph","storm_date","human_review",
        "permit_evidence_status","permit_history_count","image_damage_score",
        "roof_visual_score","image_evidence_status","evidence_score_reasons",
        "residential_status","replacement_cost",
      ].join(",")
    )
    .in("city", cities)
    .not("excluded", "is", true)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (leadError) {
    return NextResponse.json(
      { ok: false, error: leadError.message, properties: [], count: 0 },
      { status: 500 }
    );
  }

  const properties = (rows || []).map((row, index) => shapeProperty(row, index));
  const evCfg = eagleViewConfig();

  return NextResponse.json({
    ok: true,
    source: "AeroLeadAI APEX engine · batch_leads (live)",
    generatedAt: new Date().toISOString(),
    contractor: publicContractor(contractor),
    territory: cities,
    eagleView: {
      configured: eagleViewConfigured(),
      environment: evCfg.environment,
      authMode: evCfg.accessToken
        ? "bearer"
        : evCfg.apiKey
        ? "api-key"
        : evCfg.clientId && evCfg.clientSecret
        ? "oauth-client-credentials"
        : "none",
    },
    count: properties.length,
    properties,
  });
}

function publicContractor(contractor) {
  return {
    id: contractor.id,
    businessName: contractor.business_name,
    state: contractor.state,
    prospectScore: contractor.prospect_score,
  };
}

function shapeProperty(row, index) {
  const currentYear = new Date().getFullYear();
  const yearBuilt = Number(row.year_built) || null;
  const structureAge = yearBuilt ? currentYear - yearBuilt : null;
  const score = row.priority_score != null ? Math.round(Number(row.priority_score)) : null;
  const hail = row.hail_inches != null ? Number(row.hail_inches) : null;
  const wind = row.wind_mph != null ? Number(row.wind_mph) : null;

  return {
    id: row.id,
    address: cleanAddress(row.address),
    city: row.city,
    state: "MN",
    zip: row.zip,
    county: row.county,
    lat: row.lat,
    lon: row.lon,
    score,
    scoreBasis: "APEX priority_score (live)",
    confidence: row.confidence_score != null ? Number(row.confidence_score) : null,
    evidenceConfidence: row.evidence_confidence != null ? Number(row.evidence_confidence) : null,
    evidenceCompleteness: row.evidence_completeness != null ? Number(row.evidence_completeness) : null,
    tier: row.apex_tier || "unranked",
    rank: row.top500_rank ?? row.apex_rank ?? null,
    displayIndex: index + 1,
    yearBuilt,
    structureAge,
    roofAgeEstimate: structureAge != null
      ? `${structureAge} yrs since build (roof age not directly observed)`
      : "Unknown — build year not on record",
    assessedValue: row.assessed_value != null ? Number(row.assessed_value) : null,
    assessedYear: row.assessed_year,
    replacementCost: row.replacement_cost != null ? Number(row.replacement_cost) : null,
    stormExposure: {
      hailInches: hail,
      windMph: wind,
      stormDate: row.storm_date,
      label: stormLabel(hail, wind),
    },
    permit: {
      status: row.permit_evidence_status || "unchecked",
      historyCount: row.permit_history_count ?? null,
    },
    imagery: buildImagery(row),
    review: Boolean(row.human_review),
    residentialStatus: row.residential_status || null,
    reasons: normalizeReasons(row.evidence_score_reasons),
  };
}

function cleanAddress(address) {
  if (!address) return "Address unavailable";
  return String(address).replace(/\s+/g, " ").replace(/,\s*MN\s*$/i, "").trim();
}

function stormLabel(hail, wind) {
  if (hail == null && wind == null) return "No storm exposure on record";
  const parts = [];
  if (hail != null) parts.push(`${hail}" hail`);
  if (wind != null) parts.push(`${wind} mph wind`);
  return `${parts.join(" · ")} recorded (exposure, not confirmed damage)`;
}

function buildImagery(row) {
  const hasEagleView = row.image_evidence_status === "eagleview";
  if (hasEagleView) {
    return {
      source: "eagleview",
      status: "ready",
      url: `/api/eagleview/image?leadId=${encodeURIComponent(row.id)}`,
      attribution: "EagleView",
    };
  }

  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const d = 0.0009;
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    return {
      source: "esri",
      status: "fallback",
      url:
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
        `?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=600,400&format=jpg&f=image`,
      attribution: "Esri World Imagery — EagleView capture not yet requested",
    };
  }

  return {
    source: "none",
    status: "unavailable",
    url: null,
    attribution: "No coordinates on record",
  };
}

function normalizeReasons(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (typeof r === "string") return { label: r, contribution: null };
      if (r && typeof r === "object") {
        return {
          label: r.label || r.signal || "Signal",
          signal: r.signal || null,
          contribution: r.contribution ?? null,
        };
      }
      return null;
    })
    .filter(Boolean);
}
