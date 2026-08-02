import { supabaseServer } from "../../../lib/supabaseServer";
import { runPipeline } from "../../../lib/evidenceIndex/pipeline";
import { SUPPORTED_COUNTIES } from "../../../lib/evidenceIndex/config";

// GET|POST /api/evidence-index?limit=50&county=hennepin
//
// Runs real batch_leads rows through the six-module Evidence Index
// pipeline ported from evidence_index/ (countyEnricher -> stormOverlay ->
// evidenceEngine -> confidenceEngine -> opportunityEngine -> humanReview)
// and writes the result back to batch_leads (ei_* columns —
// supabase/migrations/20260802_evidence_index_columns.sql).
//
// stormOverlay makes one live NWS API call per lead (by lat/lon), so this
// route paces itself between rows and defaults to a conservative limit —
// it is not meant to be a bulk backfill in one request.
//
// Field mapping notes (batch_leads -> pipeline lead shape): age is derived
// from year_built, propertyValue from assessed_value, roofEstimate from
// replacement_cost (both populated by /api/sync-assessor-data once real
// county GIS endpoints are confirmed — see that route's own honest-status
// note). ancillaryServiceEstimates is left {} — no per-lead dollar
// estimates exist yet for tree/gutter/driveway work, only true/false
// damage flags, so ancillary evidence is scored but not yet priced into
// opportunity. permitConfidence / imageryConfidence aren't populated by
// any upstream source yet either, so confidenceScore is currently driven
// by stormConfidence alone for most leads — real, not faked, just
// incomplete until those enrichers exist.

export const maxDuration = 60;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}

async function handle(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", results: [] });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);
  const countyParam = (searchParams.get("county") || "").toLowerCase().trim();
  const counties = countyParam && SUPPORTED_COUNTIES.includes(countyParam) ? [countyParam] : SUPPORTED_COUNTIES;

  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("id, address, county, lat, lon, year_built, assessed_value, replacement_cost, permit_within_10y, review_status, tree_score, driveway_score, damage_notes")
    .in("county", counties)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(limit);

  if (error) {
    return Response.json({ ok: false, error: error.message, results: [] }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return Response.json({ ok: true, scanned: 0, results: [], note: "No matching rows with lat/lon in the six target counties." });
  }

  const currentYear = new Date().getFullYear();
  const results = [];

  for (const row of rows) {
    const lead = {
      address: row.address,
      county: row.county,
      lat: row.lat,
      lon: row.lon,
      age: row.year_built ? currentYear - row.year_built : 0,
      permitWithin10y: row.permit_within_10y || false,
      propertyValue: row.assessed_value || 0,
      roofEstimate: row.replacement_cost || 0,
      humanReviewed: row.review_status === "approved",
      treeRisk: (row.tree_score ?? 0) >= 50 || row.damage_notes?.treeOverhang === true,
      gutterDamage: row.damage_notes?.gutterIndicator === true,
      drivewayCracks: (row.driveway_score ?? 0) >= 50,
      ancillaryServiceEstimates: {},
    };

    const result = await runPipeline(lead);

    await supabase
      .from("batch_leads")
      .update({
        ei_evidence_score: result.evidenceScore,
        ei_confidence_score: result.confidenceScore,
        ei_opportunity_raw: result.opportunityRawDollars,
        ei_opportunity_normalized: result.opportunityNormalized,
        ei_review_required: result.reviewRequired,
        ei_review_reasons: result.reviewReasons,
        ei_computed_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    results.push({ id: row.id, ...result });
    await new Promise((r) => setTimeout(r, 300)); // pacing — one live NWS call per lead
  }

  return Response.json({
    ok: true,
    scanned: rows.length,
    reviewCount: results.filter((r) => r.reviewRequired).length,
    results,
  });
}
