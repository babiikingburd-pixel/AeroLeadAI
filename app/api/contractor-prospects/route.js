import { supabase } from "../../../lib/supabase";
import { calculatePriority } from "../../../lib/twincities/priorityEngine";

const FALLBACK_PROSPECTS = [
  { business_name: "APEX Exteriors LLC", prospect_score: 96, service_area_cities: ["Plymouth","Maple Grove","Brooklyn Park","Champlin","Golden Valley"] },
  { business_name: "Incline Exteriors", prospect_score: 92, service_area_cities: ["Excelsior","Deephaven","Minnetonka","Chanhassen","Chaska","Edina","Eden Prairie","Wayzata"] },
  { business_name: "Grussing Roofing & Exteriors", prospect_score: 91, service_area_cities: ["Eden Prairie","Edina","St Louis Park","Chaska","Chanhassen","Maple Grove","Bloomington"] },
  { business_name: "Storm ReNu", prospect_score: 90, service_area_cities: ["Bloomington","Richfield","Edina","Eagan","Burnsville"] },
  { business_name: "Keyprime Roofing and Remodeling", prospect_score: 89, service_area_cities: ["Golden Valley","Robbinsdale","St Louis Park","Plymouth","Maple Grove","Minneapolis"] },
  { business_name: "J Robert Roofing", prospect_score: 88, service_area_cities: ["Eden Prairie","Minnetonka","Edina","Chanhassen","Chaska","Bloomington"] },
  { business_name: "Timberline Roofing & Contracting Inc", prospect_score: 86, service_area_cities: ["Plymouth","Maple Grove","Wayzata","Minnetonka","Brooklyn Park"] },
  { business_name: "T & J Construction", prospect_score: 84, service_area_cities: ["Plymouth","Maple Grove","Brooklyn Park"] },
  { business_name: "Bayport Roofing and Siding", prospect_score: 83, service_area_cities: ["St Louis Park","Minneapolis","Golden Valley","Edina","Richfield","Bloomington"] },
  { business_name: "A-1 Restoration", prospect_score: 87, service_area_cities: ["Plymouth","Bloomington","Carver","Chanhassen","Chaska","Deephaven","Eden Prairie","Edina","Golden Valley","Excelsior","Hopkins"] },
];

// Maps a raw batch_leads row (snake_case DB columns) onto the camelCase
// shape calculatePriority actually expects, then returns the real
// priorityScore — this was the bug: the previous version passed the raw
// row straight into calculatePriority and read a `.score` field that
// doesn't exist on its return value (it's `.priorityScore`), and none of
// the snake_case DB columns matched the camelCase fields the scoring
// function reads (year_built vs yearBuilt, etc.), so every lead silently
// scored 0/undefined and "top 10" wasn't actually sorted by anything.
function scoreRow(row) {
  const result = calculatePriority({
    county: row.county,
    yearBuilt: row.year_built,
    permit_within_10y: row.permit_within_10y,
    permitChecked: !!(row.permit_notes && row.permit_notes.length > 0),
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
  return { ...row, _score: result.priorityScore, evidenceScore: result.evidenceScore, confidenceScore: result.confidenceScore, entered: result.entered };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  try {
    let q = supabase.from("contractor_candidates").select("*").eq("prospect", true).order("prospect_score", { ascending: false });
    if (name) q = q.eq("business_name", name);
    const { data: prospects, error } = await q;
    if (error) throw error;
    const list = prospects || [];
    if (name && !list.length) return Response.json({ ok: false, error: "Contractor prospect not found." }, { status: 404 });

    const selected = name ? list[0] : null;
    let leads = [];
    if (selected) {
      const cities = selected.service_area_cities || [];
      let leadQuery = supabase.from("batch_leads").select("*").eq("sales_status", "new").limit(500);
      if (cities.length) leadQuery = leadQuery.in("city", cities);
      const { data } = await leadQuery;
      leads = (data || [])
        .map(scoreRow)
        .filter((r) => r.entered && r._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, 10);
    }
    return Response.json({ ok: true, prospects: list.length ? list : FALLBACK_PROSPECTS, contractor: selected, leads });
  } catch (e) {
    const selected = name ? FALLBACK_PROSPECTS.find((p) => p.business_name === name) : null;
    if (name && !selected) return Response.json({ ok: false, error: e.message }, { status: 500 });
    return Response.json({ ok: true, prospects: FALLBACK_PROSPECTS, contractor: selected || null, leads: [], note: "Database unavailable; showing configured prospect roster only." });
  }
}
