import { supabaseServer } from "../../../lib/supabaseServer";

// Feeds the fast single-card review workflow (/twincities/review). Reuses
// the same review_status field /api/lead-review already writes to and
// /api/top-leads already reads from — this is a new front door onto the
// existing pipeline, not a parallel one.
//
// Stage split matches the proposed two-stage model:
//   Stage 1 (candidate score) = priority_score, already computed cheaply
//   for every lead with no image involved.
//   Stage 2 (this screen) = human review, gated to only the top slice
//   (?minScore, default 80) so review time goes to the leads worth it.
export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", queue: [], funnel: null }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const minScore = Number(searchParams.get("minScore") ?? 80);
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);

  const { data: queue, error } = await supabase
    .from("batch_leads")
    .select("id, address, city, county, lat, lon, year_built, assessed_value, hail_inches, wind_mph, storm_date, priority_score, evidence_score, confidence_score, evidence_breakdown, review_status")
    .gte("priority_score", minScore)
    .or("review_status.is.null,review_status.eq.pending")
    .order("priority_score", { ascending: false })
    .limit(limit);

  if (error) {
    return Response.json({ ok: false, error: error.message, queue: [], funnel: null }, { status: 500 });
  }

  // Funnel counts, cheap aggregate queries — gives the live counter the
  // proposal asked for: discovered -> valid -> qualified -> high-score -> confirmed.
  const [{ count: discovered }, { count: geoValid }, { count: qualified }, { count: highScore }, { count: confirmed }] = await Promise.all([
    supabase.from("batch_leads").select("id", { count: "exact", head: true }),
    supabase.from("batch_leads").select("id", { count: "exact", head: true }).not("lat", "is", null).not("lon", "is", null),
    supabase.from("batch_leads").select("id", { count: "exact", head: true }).gt("evidence_score", 0),
    supabase.from("batch_leads").select("id", { count: "exact", head: true }).gte("priority_score", minScore),
    supabase.from("batch_leads").select("id", { count: "exact", head: true }).eq("review_status", "approved"),
  ]);

  return Response.json({
    ok: true,
    queue: queue || [],
    minScore,
    funnel: { discovered, geoValid, qualified, highScore, confirmed },
  });
}
