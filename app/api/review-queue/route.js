import { supabaseServer } from "../../../lib/supabaseServer";
import { gateConfig, evaluatePromotion, summarizeBlockers, calculateEvidenceDebt } from "../../../lib/twincities/evidenceDebt";
export const dynamic = "force-dynamic";

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

  // Pull a wider candidate window than we intend to show, because the
  // confidence floor and evidence gates below will reject most of it. Showing
  // `limit` rows requires having more than `limit` candidates to filter.
  const cfg = gateConfig();
  const { data: candidates, error } = await supabase
    .from("batch_leads")
    .select("id, address, city, county, lat, lon, year_built, assessed_value, hail_inches, wind_mph, storm_date, priority_score, evidence_score, confidence_score, evidence_breakdown, review_status, property_class, promotion_streak, permit_evidence_status, value_evidence_status, image_evidence_status, storm_evidence_status")
    .gte("priority_score", minScore)
    .or("review_status.is.null,review_status.eq.pending")
    .order("priority_score", { ascending: false })
    .limit(Math.max(limit * 20, 500));

  if (error) {
    return Response.json({ ok: false, error: error.message, queue: [], funnel: null }, { status: 500 });
  }

  // CONFIDENCE FLOOR. A lead does not reach a human until its rank is actually
  // backed by evidence. Withheld leads are reported, not silently dropped — an
  // empty review queue with a stated reason is the honest answer while permit,
  // imagery and storm are all still unresolved.
  const rows = candidates ?? [];
  const passed = [];
  const withheld = [];
  for (const row of rows) {
    const verdict = evaluatePromotion(row, cfg);
    if (verdict.eligible) passed.push(row);
    else withheld.push({ id: row.id, priority_score: row.priority_score, confidence_score: row.confidence_score, blockers: verdict.blockers });
  }
  const queue = passed.slice(0, limit);

  // What the system should work on next, ordered by evidence debt: the
  // highest-ranked, least-substantiated leads first.
  const nextToValidate = rows
    .map((row) => ({ row, ...calculateEvidenceDebt(row, { confidenceFloor: cfg.confidenceFloor }) }))
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 10)
    .map(({ row, debt, missing, cheapestNext, reasons }) => ({
      id: row.id, priority_score: row.priority_score, confidence_score: row.confidence_score,
      evidenceDebt: debt, missing, nextAction: cheapestNext?.key ?? null,
      nextActionCost: cheapestNext?.cost ?? null, reasons,
    }));

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

    // The gate, stated out loud. If the queue is empty this explains exactly
    // why, and `nextToValidate` says what to run to change it.
    gate: {
      confidenceFloor: cfg.confidenceFloor,
      minScore: cfg.minScore,
      residentialOnly: cfg.residentialOnly,
      maxAssessedValue: cfg.maxAssessedValue,
      requiredEvidence: cfg.requiredEvidence,
      stabilityCycles: cfg.stabilityCycles,
      enabled: cfg.enabled,
    },
    candidatesConsidered: rows.length,
    shown: queue.length,
    withheldCount: withheld.length,
    withheldReasons: summarizeBlockers(rows, cfg),
    withheldSample: withheld.slice(0, 10),
    nextToValidate,
  });
}
