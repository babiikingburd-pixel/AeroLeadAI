import { supabaseServer } from "../../../lib/supabaseServer";
import { TC_COUNTIES, FAST_SCORE_FIELDS, scoreRow } from "../../../lib/twincities/fastCycle";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIER_CAPS = { review: 100, candidates: 500, contractor: 20 };

function addressKey(r) {
  return [r.address || "", r.city || "", r.county || ""]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "");
}

function residentialEnough(r) {
  const cls = String(r.property_class || "").toLowerCase();
  const addr = String(r.address || "").toLowerCase();
  const blocked = ["apartment", "apartments", "multifamily", "multi-family", "commercial", "industrial", "office", "retail", "hotel", "school", "church", "condo building"];
  if (blocked.some(x => cls.includes(x) || addr.includes(x))) return false;
  return !!r.address && r.lat != null && r.lon != null;
}

function freeSatelliteFallback(lat, lon) {
  const d = 0.0012;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon-d},${lat-d},${lon+d},${lat+d}&bboxSR=4326&imageSR=4326&size=640,640&format=jpg&f=image`;
}

function rankRows(rows) {
  const best = new Map();
  for (const raw of rows || []) {
    if (!residentialEnough(raw)) continue;
    const scored = scoreRow(raw);
    const score = Number(scored.priorityScore ?? raw.priority_score ?? 0);
    const confidence = Number(scored.confidenceScore ?? raw.confidence_score ?? 0);
    if (!scored.entered && score <= 0) continue;
    const row = { ...raw, ...scored, priorityScore: score, confidenceScore: confidence };
    const key = addressKey(row) || String(row.id);
    const prior = best.get(key);
    if (!prior || score > prior.priorityScore || (score === prior.priorityScore && confidence > prior.confidenceScore)) best.set(key, row);
  }
  return [...best.values()].sort((a,b) => b.priorityScore-a.priorityScore || b.confidenceScore-a.confidenceScore);
}

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok:false, error:"Supabase not configured.", leads:[], total:0 }, { status:500 });

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("tier");
  const tier = TIER_CAPS[requested] ? requested : "review";
  const limit = Math.min(Number(searchParams.get("limit")) || TIER_CAPS[tier], TIER_CAPS[tier]);

  // Pull a broad live pool and score it here so Top 100/500 never depend on a prior cron run.
  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select(FAST_SCORE_FIELDS)
    .in("county", TC_COUNTIES)
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .limit(2000);

  if (error) return Response.json({ ok:false, error:error.message, leads:[], total:0 }, { status:500 });

  const ranked = rankRows(rows);
  // Top 100 is literally the strongest first 100 of the Top 500 and is the default human-review queue.
  let pool = tier === "contractor"
    ? ranked.filter(r => r.review_status === "approved")
    : ranked;
  if (tier === "candidates") pool = pool.slice(0, 500);
  if (tier === "review") pool = pool.slice(0, 100);

  const top = pool.slice(0, limit).map((r, i) => ({
    id:r.id, rank:i+1, address:r.address, city:r.city, county:r.county, lat:r.lat, lon:r.lon,
    assessedValue:r.assessed_value,
    evidenceScore:Number(r.evidenceScore ?? r.evidence_score ?? 0),
    confidenceScore:Number(r.confidenceScore ?? r.confidence_score ?? 0),
    priorityScore:Number(r.priorityScore ?? r.priority_score ?? 0),
    humanReview:tier === "review" ? true : !!r.humanReview,
    reviewStatus:r.review_status || "pending",
    categories:r.categories || [], breakdown:r.breakdown || {},
    validationStatus:r.validation_status || "unvalidated",
    validationScore:r.validation_score ?? 0,
    validationConfidence:r.validation_confidence ?? 0,
    lastValidatedAt:r.last_validated_at, scoredAt:r.scored_at,
    imageUrl:null, imageIsFallback:false,
  }));

  try {
    const ids = top.map(r => r.id).filter(Boolean);
    if (ids.length) {
      const { data: images } = await supabase
        .from("property_images")
        .select("property_id,image_url,enhanced_image_url,original_image_url,fetched_at")
        .in("property_id", ids)
        .order("fetched_at", { ascending:false });
      const byId = new Map();
      for (const img of images || []) if (!byId.has(String(img.property_id))) byId.set(String(img.property_id), img.enhanced_image_url || img.image_url || img.original_image_url || null);
      for (const lead of top) {
        const cached = byId.get(String(lead.id));
        if (cached) lead.imageUrl = cached;
      }
    }
  } catch (e) { console.warn(`[top-leads] image lookup failed: ${e.message}`); }

  for (const lead of top) {
    if (!lead.imageUrl && lead.lat != null && lead.lon != null) {
      lead.imageUrl = freeSatelliteFallback(Number(lead.lat), Number(lead.lon));
      lead.imageIsFallback = true;
    }
  }

  return Response.json({
    ok:true, tier, cap:TIER_CAPS[tier], leads:top, total:top.length,
    scanned:(rows || []).length, entered:ranked.length,
    top100Count:Math.min(100, ranked.length), top500Count:Math.min(500, ranked.length),
    liveScored:true, deduped:true, residentialFiltered:true,
  });
}
