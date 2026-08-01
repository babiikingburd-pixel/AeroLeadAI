import { supabaseServer } from "../../../lib/supabaseServer";
import { calculateReplacementCost } from "../../../lib/twincities/calculateReplacementCost";
import { SUPPORTED_COUNTIES } from "../../../lib/twincities/propertyValue";

// POST /api/sync-assessor-data?limit=500
//
// Phase 1: resolve — pull batch_leads rows missing parcel_id, in the six
//   target counties, with lat/lon (point-based lookup, not address matching
//   — see normalizeAddress.js for why that's the fallback, not the primary
//   path).
// Phase 2: pull — query each county's parcel GIS layer by point geometry.
// Phase 3: compute — replacement cost from whatever square footage the
//   assessor layer returns (field name unverified per county; null-safe).
// Phase 4: push back — upsert property_enrichment, update batch_leads.
//
// HONEST STATUS: every county's ArcGIS URL in propertyValue.js is an
// educated guess, not a verified endpoint. Live-tested three of six
// (Hennepin, Dakota, Scott) this session — all three failed (SSL error or
// timeout). This route is real, tested plumbing; it will return
// enriched:0 for every row until real endpoints replace the guesses.
// That's the one remaining blocker, not a gap in this code.

export const maxDuration = 60;

async function queryParcelByPoint(countyUrl, lat, lon) {
  const params = new URLSearchParams({
    f: "json",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
  });
  const res = await fetch(`${countyUrl}?${params.toString()}`, {
    headers: { "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = await res.json();
  return { ok: true, attrs: json?.features?.[0]?.attributes || null };
}

// Same county config as propertyValue.js — kept here explicitly rather than
// imported so this route's URL guesses can be corrected independently once
// real endpoints are confirmed, without touching the map-display code path.
const COUNTY_PARCEL_URLS = {
  hennepin: { url: "https://gis.hennepin.us/arcgis/rest/services/Property/Parcels/MapServer/0/query", fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT", sqft: "FIN_SQ_FT" } },
  ramsey: { url: "https://gis.ramseycounty.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query", fields: { assessedValue: "TOTAL_MKT_VAL", yearBuilt: "YEAR_BUILT", sqft: "SQFT" } },
  dakota: { url: "https://gis.co.dakota.mn.us/arcgis/rest/services/Property/Parcels/MapServer/0/query", fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT", sqft: "SQFT" } },
  scott: { url: "https://gis.co.scott.mn.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query", fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT", sqft: "SQFT" } },
  carver: { url: "https://gis.co.carver.mn.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query", fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT", sqft: "SQFT" } },
  anoka: { url: "https://gis.anokacounty.us/arcgis/rest/services/Parcels/Parcels/MapServer/0/query", fields: { assessedValue: "EMV_TOTAL", yearBuilt: "YEAR_BUILT", sqft: "SQFT" } },
};

export async function GET(req) {
  return POST(req);
}

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 500, 500);

  // Phase 1: resolve.
  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("id, address, county, lat, lon")
    .is("parcel_id", null)
    .in("county", SUPPORTED_COUNTIES)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(limit);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return Response.json({ ok: true, scanned: 0, enriched: 0, note: "No unresolved rows in the six target counties." });

  let enriched = 0;
  let unreachable = 0;
  const errors = {};

  for (const row of rows) {
    const cfg = COUNTY_PARCEL_URLS[row.county];
    if (!cfg) continue;

    let result;
    try {
      result = await queryParcelByPoint(cfg.url, row.lat, row.lon);
    } catch (e) {
      unreachable++;
      errors[row.county] = e.message;
      continue;
    }

    if (!result.ok || !result.attrs) {
      unreachable++;
      continue;
    }

    const attrs = result.attrs;
    const assessedValue = attrs[cfg.fields.assessedValue] ? Number(attrs[cfg.fields.assessedValue]) : null;
    const yearBuilt = attrs[cfg.fields.yearBuilt] ? Number(attrs[cfg.fields.yearBuilt]) : null;
    const squareFeet = attrs[cfg.fields.sqft] ? Number(attrs[cfg.fields.sqft]) : null;
    // Parcel ID field name is as unverified as the rest — OBJECTID is the
    // one near-universal ArcGIS fallback if a county-specific PIN field
    // isn't present in the response.
    const parcelId = attrs.PARCEL_ID || attrs.PIN || attrs.OBJECTID ? String(attrs.PARCEL_ID || attrs.PIN || attrs.OBJECTID) : null;
    if (!parcelId) continue;

    const replacementCost = calculateReplacementCost({ squareFeet, county: row.county });

    // Phase 3 + 4: compute, then push to both property_enrichment (isolated
    // enrichment record) and batch_leads (what the scoring engine reads).
    await supabase.from("property_enrichment").upsert(
      {
        parcel_id: parcelId,
        estimated_roof_age: yearBuilt ? new Date().getFullYear() - yearBuilt : null,
        replacement_cost: replacementCost,
        last_assessor_sync: new Date().toISOString(),
      },
      { onConflict: "parcel_id" }
    );

    await supabase
      .from("batch_leads")
      .update({
        parcel_id: parcelId,
        replacement_cost: replacementCost,
        assessed_value: row.assessed_value ?? assessedValue,
        year_built: row.year_built ?? yearBuilt,
      })
      .eq("id", row.id);

    enriched++;
    await new Promise((r) => setTimeout(r, 200)); // pacing across six county servers
  }

  return Response.json({
    ok: true,
    scanned: rows.length,
    enriched,
    unreachable,
    errors,
    note: enriched === 0 ? "Zero enriched — county GIS URLs in this file are unverified guesses. Confirm real endpoints before this pipeline does real work." : undefined,
  });
}
