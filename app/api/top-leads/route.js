import { supabaseServer } from "../../../lib/supabaseServer";
import { SUPPORTED_COUNTIES } from "../../../lib/twincities/propertyValue";
import { calculatePriority } from "../../../lib/twincities/priorityEngine";

// GET /api/top-leads?tier=candidates|review|contractor
//
// tier caps (per the first-pass Twin Cities plan):
//   candidates  -> top 500, no review_status filter (the full ranked pool)
//   review      -> top 100 flagged for human review (human_review = true)
//   contractor  -> top 20 approved leads only (review_status = 'approved')
//
// The six-county Twin Cities strategic pipeline:
//   batch_leads (county filter, sales_status='new', permit_within_10y=false)
//     -> read assessed_value (populated out-of-band by /api/sync-assessor-data's
//        cron, NOT enriched live in this request — see note below)
//     -> Evidence Index v1.1 (age/storm entry + additional evidence points)
//     -> confidence score (data-completeness, separate from evidence)
//     -> human-review determination
//     -> Final Priority Score (45% evidence / 35% property value / 20% job estimate, x county multiplier)
//     -> evidence_breakdown / review_status written back
//     -> sorted, capped, returned
//
// This route used to call enrichLeadValue() inline per row on a cache miss,
// hitting a live county ArcGIS endpoint synchronously inside the request.
// With most rows still unenriched (the six county GIS URLs are unverified
// guesses — see propertyValue.js's honest-status note), that meant nearly
// every row in a 2000-row scan attempted a live network call before this
// route could respond, reliably exceeding maxDuration and causing Vercel to
// return a non-JSON timeout page instead of a response — the "Unexpected
// token 'A', is not valid JSON" error this was fixed to stop reproducing.
// Enrichment is /api/sync-assessor-data's job (paced, cron-scheduled,
// decoupled from user requests); this route only ever reads what's already
// on the row now, so it stays fast regardless of county GIS reachability.
//
// Storm evidence (hail_inches / wind_mph / heavySnowRegion etc.) is read
// from whatever's already on the batch_leads row. This route does NOT run
// a NOAA storm crawler itself — if those columns are still empty for a
// county, that county's leads will only qualify via Route A (maturity),
// not Route B (storm override), until a storm-history enrichment pass is
// wired in. That's the accurate next step, not a silent gap.

export const maxDuration = 60;

const TARGET_COUNTIES = SUPPORTED_COUNTIES; // hennepin, ramsey, dakota, scott, carver, anoka

const TIER_CAPS = { candidates: 500, review: 100, contractor: 20 };

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase not configured.", leads: [], total: 0 });
  }

  const { searchParams } = new URL(req.url);
  const tier = TIER_CAPS[searchParams.get("tier")] ? searchParams.get("tier") : "candidates";
  const limit = Math.min(Number(searchParams.get("limit")) || TIER_CAPS[tier], TIER_CAPS[tier]);

  // 1. Pull the working set: six target counties, unworked, no roof permit
  //    within 10 years (the "hasn't been touched" filter from the plan).
  //    Rejected leads are excluded here too — a human already said no.
  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("*")
    .in("county", TARGET_COUNTIES)
    .eq("sales_status", "new")
    .eq("permit_within_10y", false)
    .neq("review_status", "rejected")
    .limit(400); // safety ceiling on the scoring pass, not the final output

  if (error) {
    return Response.json({ ok: false, error: error.message, leads: [], total: 0 }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return Response.json({ ok: true, leads: [], total: 0, tier, note: "No matching leads. Confirm batch_leads.county is populated — it's a new column and may be empty for existing rows." });
  }

  // 2. Score every lead: evidence -> confidence -> human review -> THEN
  //    priority. Uses assessed_value/year_built/replacement_cost exactly as
  //    they currently sit on the row — no live enrichment call here (see
  //    the file-level note above for why that moved to sync-assessor-data).
  const scored = rows.map((row) => {
    const priorityInput = {
      county: row.county,
      yearBuilt: row.year_built,
      permit_within_10y: row.permit_within_10y,
      hailInches: row.hail_inches,
      windMph: row.wind_mph,
      assessedValue: row.assessed_value,
      reviewStatus: row.review_status,
      roofEstimateUsd: row.replacement_cost ?? null, // now sourced from batch_leads.replacement_cost (property_enrichment sync target)
      // Evidence categories not yet columns on batch_leads (heavySnowRegion,
      // treeOverhang, etc.) read from damage_notes if present, else false —
      // never fabricated as true.
      heavySnowRegion: row.damage_notes?.heavySnowRegion === true,
      heavyRainRegion: row.damage_notes?.heavyRainRegion === true,
      treeOverhang: row.damage_notes?.treeOverhang === true || (row.tree_score ?? 0) >= 50,
      largeOverhang: row.damage_notes?.largeOverhang === true || (row.tree_score ?? 0) >= 80,
      drivewayCrackRisk: (row.driveway_score ?? 0) >= 50,
      gutterIndicator: row.damage_notes?.gutterIndicator === true,
    };

    const result = calculatePriority(priorityInput);
    return { ...row, ...result };
  });

  // 3. Write the full audit trail back — evidence_breakdown answers "why
  //    did this score X" without re-deriving anything; review_status only
  //    advances to 'pending' the first time (never overwrites an existing
  //    approved/rejected/contractor_sent state a human already set).
  const enteredRows = scored.filter((r) => r.entered);
  const WRITE_CHUNK_SIZE = 25;
  for (let i = 0; i < enteredRows.length; i += WRITE_CHUNK_SIZE) {
    const chunk = enteredRows.slice(i, i + WRITE_CHUNK_SIZE);
    await Promise.all(
      chunk.map((r) =>
        supabase
          .from("batch_leads")
          .update({
            evidence_score: r.evidenceScore,
            evidence_categories: r.categories,
            evidence_breakdown: r.breakdown,
            confidence_score: r.confidenceScore,
            priority_score: r.priorityScore,
            human_review: r.humanReview,
            ...(r.humanReview && !r.reviewStatus ? { review_status: "pending" } : {}),
          })
          .eq("id", r.id)
      )
    );
  }

  // 4. Apply the requested tier filter, rank, cap.
  let pool = scored.filter((r) => r.entered && r.priorityScore > 0);
  if (tier === "review") pool = pool.filter((r) => r.humanReview);
  if (tier === "contractor") pool = pool.filter((r) => r.review_status === "approved" || r.reviewStatus === "approved");

  const top = pool
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      address: r.address,
      city: r.city,
      county: r.county,
      lat: r.lat,
      lon: r.lon,
      assessedValue: r.assessed_value,
      evidenceScore: r.evidenceScore,
      confidenceScore: r.confidenceScore,
      priorityScore: r.priorityScore,
      humanReview: r.humanReview,
      reviewStatus: r.review_status || "pending",
      categories: r.categories,
      breakdown: r.breakdown,
      route: r.route,
    }));

  return Response.json({
    ok: true,
    tier,
    cap: TIER_CAPS[tier],
    leads: top,
    total: top.length,
    scanned: rows.length,
    entered: scored.filter((r) => r.entered).length,
  });
}
