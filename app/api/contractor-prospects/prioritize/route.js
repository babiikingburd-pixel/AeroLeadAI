// Prioritize a contractor prospect: bumps their prospect_score above the
// current highest score (so they sort to the very top of the Prospect
// Bench), then immediately recomputes their lead list live — the same
// scoring pipeline /api/contractor-prospects?name= already runs on every
// call, so "recalibrating" isn't a separate stale cache to invalidate,
// it's just running that live query right now and handing back fresh
// numbers ready to present.
import { supabaseServer } from "../../../../lib/supabaseServer";
import { calculatePriority } from "../../../../lib/twincities/priorityEngine";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const { businessName } = await req.json().catch(() => ({}));
  if (!businessName?.trim()) return Response.json({ ok: false, error: "businessName required." }, { status: 400 });

  const { data: top, error: topErr } = await supabase
    .from("contractor_candidates")
    .select("prospect_score")
    .eq("prospect", true)
    .order("prospect_score", { ascending: false })
    .limit(1);
  if (topErr) return Response.json({ ok: false, error: topErr.message }, { status: 500 });

  const currentTop = top?.[0]?.prospect_score ?? 0;
  const newScore = Math.min(100, Math.max(currentTop + 1, 97));

  const { data: updated, error: updateErr } = await supabase
    .from("contractor_candidates")
    .update({ prospect_score: newScore, pitch_status: "prioritized" })
    .eq("business_name", businessName.trim())
    .select()
    .single();
  if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
  if (!updated) return Response.json({ ok: false, error: "Contractor prospect not found." }, { status: 404 });

  // Recalibrate: live-score every property in this contractor's service
  // area right now, same as the standard ?name= lookup.
  const cities = updated.service_area_cities || [];
  let leadQuery = supabase.from("batch_leads").select("*").eq("sales_status", "new").limit(500);
  if (cities.length) leadQuery = leadQuery.in("city", cities);
  const { data: rows, error: leadsErr } = await leadQuery;
  if (leadsErr) return Response.json({ ok: true, contractor: updated, leads: [], note: "Prioritized, but lead recalibration failed: " + leadsErr.message });

  const leads = (rows || [])
    .map(scoreRow)
    .filter((r) => r.entered && r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);

  return Response.json({ ok: true, contractor: updated, leads, newTopScore: newScore });
}
