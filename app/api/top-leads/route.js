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

// Same free, keyless Esri World Imagery export used server-side as the
// last-resort provider in imagery-agent/route.js's tryEsri() — reused here
// directly as a client-renderable URL so every lead shows a real satellite
// photo even before it's gone through (paid) imagery-agent enrichment.
// imageIsFallback distinguishes this from a real fetched/reviewed photo —
// never let a placeholder look identical to actual evidence.
// Free, keyless deep link into Google's own consumer Street View UI —
// the same "time travel" feature a human can browse by hand, just linked
// directly to this property's coordinates instead of making them search.
// No API key, no billing account, no image fetched or stored server-side —
// this only ever opens Google's site in the reviewer's own browser.
function streetViewUrl(lat, lon) {
  return `https://www.google.com/maps?layer=c&cbll=${lat},${lon}`;
}

function freeSatelliteFallback(lat, lon) {
  // Verified against the live Esri export endpoint: deltas below ~0.0007
  // degrees make ArcGIS reject the request outright with a 500 ("Error:
  // bytes") — the bbox is too small relative to the 640x640 output size.
  // 0.0008 (~180m box) is the smallest delta confirmed to reliably return
  // a real image across multiple Twin Cities test points.
  const d = 0.0008;
  return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&f=image`;
}

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
  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("id,address,city,county,lat,lon,assessed_value,evidence_score,confidence_score,priority_score,human_review,review_status,evidence_categories,evidence_breakdown,validation_status,validation_score,validation_confidence,last_validated_at,scored_at")
    .in("county", TARGET_COUNTIES)
    .eq("sales_status", "new")
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
    lastValidatedAt: r.last_validated_at, scoredAt: r.scored_at, imageUrl: null, imageIsFallback: false,
    streetViewUrl: r.lat != null && r.lon != null ? streetViewUrl(r.lat, r.lon) : null,
  }));

  try {
    const ids = top.map(r => r.id);
    if (ids.length) {
      const { data: images } = await supabase
        .from("property_images")
        .select("property_id,image_url,enhanced_image_url,original_image_url,provider,quality_score,fetched_at,image_kind")
        .in("property_id", ids)
        .order("fetched_at", { ascending: false });
      const byId = new Map();
      for (const img of images || []) {
        if (!byId.has(img.property_id)) {
          byId.set(img.property_id, img.enhanced_image_url || img.image_url || img.original_image_url || null);
        }
      }
      for (const lead of top) {
        const cached = byId.get(lead.id);
        if (cached) lead.imageUrl = cached;
      }
    }
  } catch (err) { console.warn(`[top-leads] image lookup failed: ${err.message}`); }

  // Every lead gets a real photo one way or another: a cached/reviewed
  // fetch if one exists, otherwise the free Esri satellite export so the
  // dashboard never shows a blank image tile.
  for (const lead of top) {
    if (!lead.imageUrl && lead.lat != null && lead.lon != null) {
      lead.imageUrl = freeSatelliteFallback(lead.lat, lead.lon);
      lead.imageIsFallback = true;
    }
  }

  return Response.json({ ok: true, tier, cap: TIER_CAPS[tier], leads: top, total: top.length, scanned: rows?.length || 0, readOnly: true, scoringPath: "/api/twincities/fast-cycle" });
}
