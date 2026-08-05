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

  // FAST PATH: this endpoint is now read-only. Scoring and validation are performed
  // by /api/twincities/fast-cycle and /api/twincities/validation-worker. The old
  // GET path scored 400 rows and wrote them back on every dashboard refresh.
  //
  // permit_within_10y stays filtered here. checkEntry()'s storm route lets a
  // lead enter on storm evidence alone even when a roof permit was pulled
  // recently, so a permitted lead CAN carry a nonzero priority_score once
  // fast-cycle persists it. Surfacing an already-re-roofed house to a roofer
  // is the exact thing the priority-worker permit gate exists to prevent —
  // dropping this filter when the endpoint went read-only would have quietly
  // re-admitted them. Currently a no-op (all 152,203 rows sit at the
  // unpopulated default false), which is precisely why it has to be here
  // before real permit results start landing.
  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("id,address,city,county,lat,lon,assessed_value,evidence_score,confidence_score,priority_score,human_review,review_status,evidence_categories,evidence_breakdown,validation_status,validation_score,validation_confidence,last_validated_at,scored_at")
    .in("county", TARGET_COUNTIES)
    .eq("sales_status", "new")
    .eq("permit_within_10y", false)
    .neq("review_status", "rejected")
    .gt("priority_score", 0)
    .order("priority_score", { ascending: false })
    .order("confidence_score", { ascending: false, nullsFirst: false })
    .limit(limit * 2);

  if (error) return Response.json({ ok: false, error: error.message, leads: [], total: 0 }, { status: 500 });

  let pool = rows || [];
  if (tier === "review") pool = pool.filter(r => r.human_review === true);
  if (tier === "contractor") pool = pool.filter(r => r.review_status === "approved");
  const top = pool.slice(0, limit).map(r => ({
    id: r.id, address: r.address, city: r.city, county: r.county,
    lat: r.lat, lon: r.lon, assessedValue: r.assessed_value,
    evidenceScore: r.evidence_score ?? 0, confidenceScore: r.confidence_score ?? 0,
    priorityScore: r.priority_score ?? 0, humanReview: !!r.human_review,
    reviewStatus: r.review_status || "pending", categories: r.evidence_categories || [],
    breakdown: r.evidence_breakdown || {}, validationStatus: r.validation_status || "unvalidated",
    validationScore: r.validation_score ?? 0, validationConfidence: r.validation_confidence ?? 0,
    lastValidatedAt: r.last_validated_at, scoredAt: r.scored_at, imageUrl: null,
  }));

  try {
    const ids = top.map(r => r.id);
    if (ids.length) {
      const { data: images } = await supabase.from("property_images").select("property_id,image_url,fetched_at").in("property_id", ids).order("fetched_at", { ascending: false });
      const byId = new Map();
      for (const img of images || []) if (!byId.has(img.property_id)) byId.set(img.property_id, img.image_url);
      for (const lead of top) lead.imageUrl = byId.get(lead.id) ?? null;
    }
  } catch (err) { console.warn(`[top-leads] image lookup failed: ${err.message}`); }

  return Response.json({ ok: true, tier, cap: TIER_CAPS[tier], leads: top, total: top.length, scanned: rows?.length || 0, readOnly: true, scoringPath: "/api/twincities/fast-cycle" });
}
