import { supabaseServer } from "../../../../lib/supabaseServer";
import { SUPPORTED_COUNTIES } from "../../../../lib/twincities/propertyValue";
import { calculatePriority } from "../../../../lib/twincities/priorityEngine";
import { getContractor } from "../../../../lib/twincities/contractors";

// Generalized top-N contractor report endpoint — replaces the one-off
// /api/apex10 (kept as a redirect for any link already sent out, see that
// route). Does not alter batch_leads or the existing /api/top-leads
// pipeline; read-only ranking of a contractor's configured service area for
// sales demos.
export const maxDuration = 30;

function scoreRow(row) {
  const result = calculatePriority({
    county: row.county,
    yearBuilt: row.year_built,
    permit_within_10y: row.permit_within_10y,
    hailInches: row.hail_inches,
    windMph: row.wind_mph,
    assessedValue: row.assessed_value,
    reviewStatus: row.review_status,
    roofEstimateUsd: row.replacement_cost ?? null,
    heavySnowRegion: row.damage_notes?.heavySnowRegion === true,
    heavyRainRegion: row.damage_notes?.heavyRainRegion === true,
    treeOverhang: row.damage_notes?.treeOverhang === true || (row.tree_score ?? 0) >= 50,
    largeOverhang: row.damage_notes?.largeOverhang === true || (row.tree_score ?? 0) >= 80,
    drivewayCrackRisk: (row.driveway_score ?? 0) >= 50,
    gutterIndicator: row.damage_notes?.gutterIndicator === true,
  });
  return { ...row, ...result };
}

export async function GET(request, { params }) {
  const contractor = getContractor(params.contractor);
  if (!contractor) {
    return Response.json(
      { ok: false, error: `Unknown contractor report: "${params.contractor}"`, leads: [] },
      { status: 404 }
    );
  }

  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", leads: [] }, { status: 500 });
  }

  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("*")
    .in("county", SUPPORTED_COUNTIES)
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .in("city", contractor.serviceAreaCities)
    .limit(250);

  if (error) {
    return Response.json({ ok: false, error: error.message, leads: [] }, { status: 500 });
  }

  const limit = contractor.limit ?? 10;
  const scored = (rows || [])
    .map(scoreRow)
    .filter((r) => r.entered && r.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);

  return Response.json({
    ok: true,
    contractor: contractor.displayName,
    serviceArea: contractor.serviceAreaCities,
    limit,
    generatedAt: new Date().toISOString(),
    scanned: rows?.length || 0,
    leads: scored.map((r) => ({
      id: r.id,
      address: r.address,
      city: r.city,
      county: r.county,
      lat: r.lat,
      lon: r.lon,
      yearBuilt: r.year_built,
      assessedValue: r.assessed_value,
      hailInches: r.hail_inches,
      windMph: r.wind_mph,
      stormDate: r.storm_date,
      permitWithin10y: r.permit_within_10y,
      priorityScore: r.priorityScore,
      evidenceScore: r.evidenceScore,
      confidenceScore: r.confidenceScore,
      categories: r.categories,
      breakdown: r.breakdown,
      route: r.route,
      mapUrl: r.lat != null && r.lon != null
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.lat},${r.lon}`)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.address}, ${r.city}, MN`)}`,
    })),
  });
}
