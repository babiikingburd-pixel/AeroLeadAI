import { supabaseServer } from "../../../../lib/supabaseServer";
import { eagleViewConfig, eagleViewConfigured, requestPropertyData, findRequestId, getPropertyResult, extractPropertyImages } from "../../../../lib/eagleview";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_ANCHOR = process.env.EAGLEVIEW_EDINA_ANCHOR || "4300 Interlachen Blvd, Edina, MN 55436";
const FALLBACK_ANCHOR = "Vernon Ave S & Interlachen Blvd, Edina, MN 55436";
const DEFAULT_RADIUS_MILES = Number(process.env.EAGLEVIEW_EDINA_RADIUS_MILES || 1);
const DEFAULT_LIMIT = Number(process.env.EAGLEVIEW_EDINA_DAILY_LIMIT || 5);
// User estimates ~26 days remaining as of 2026-08-16. Override in Vercel if EagleView shows a different expiry.
const CAMPAIGN_END = new Date(process.env.EAGLEVIEW_CAMPAIGN_END || "2026-09-11T23:59:59-05:00");

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function geocode(origin, address) {
  const res = await fetch(`${origin}/api/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.ok) return null;
  return { lat: Number(data.lat), lon: Number(data.lon), matchedAddress: data.matchedAddress || address, provider: data.provider };
}

async function pollResult(requestId, attempts = 8, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const result = await getPropertyResult(requestId);
    if (result.status === 200) return result.data;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

async function run(req, options = {}) {
  if (Date.now() > CAMPAIGN_END.getTime()) {
    return Response.json({ ok: true, stopped: true, campaign: "edina-interlachen-radius", reason: "trial_window_ended", campaignEnd: CAMPAIGN_END.toISOString() });
  }

  if (!eagleViewConfigured()) {
    return Response.json({ ok: false, error: "EagleView credentials are not configured in this deployment." }, { status: 500 });
  }

  const cfg = eagleViewConfig();
  const origin = new URL(req.url).origin;
  const radiusMiles = Math.max(0.25, Math.min(Number(options.radiusMiles || DEFAULT_RADIUS_MILES), 3));
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT), 20));
  const requestedAnchor = String(options.anchorAddress || DEFAULT_ANCHOR).trim();

  let anchor = await geocode(origin, requestedAnchor);
  let anchorUsed = requestedAnchor;
  if (!anchor) {
    anchor = await geocode(origin, FALLBACK_ANCHOR);
    anchorUsed = FALLBACK_ANCHOR;
  }
  if (!anchor) {
    return Response.json({ ok: false, error: "Could not geocode the Interlachen Boulevard anchor." }, { status: 422 });
  }

  // EagleView's documented sandbox Property Data coverage is Omaha-only.
  // Do not spend sandbox calls on an Edina address that cannot succeed.
  if (cfg.environment !== "production") {
    return Response.json({
      ok: false,
      blocked: true,
      reason: "edina_requires_production",
      environment: cfg.environment,
      anchor: { ...anchor, requested: requestedAnchor, used: anchorUsed },
      note: "The Edina radius campaign is ready, but EagleView sandbox Property Data is geographically limited. Switch EAGLEVIEW_ENVIRONMENT to production when your EagleView production entitlement is active.",
    }, { status: 409 });
  }

  const supabase = supabaseServer();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase is not configured." }, { status: 500 });
  }

  const latDelta = radiusMiles / 69;
  const lonDelta = radiusMiles / (69 * Math.max(Math.cos(anchor.lat * Math.PI / 180), 0.2));

  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("id,address,city,state,zip,lat,lon,priority_score,confidence_score,image_evidence_status,image_fetched_at")
    .gte("lat", anchor.lat - latDelta)
    .lte("lat", anchor.lat + latDelta)
    .gte("lon", anchor.lon - lonDelta)
    .lte("lon", anchor.lon + lonDelta)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const inRadius = (rows || [])
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
    .map((r) => ({ ...r, distanceMiles: haversineMiles(anchor.lat, anchor.lon, r.lat, r.lon) }))
    .filter((r) => r.distanceMiles <= radiusMiles);

  const candidates = inRadius
    .sort((a, b) => (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0) || a.distanceMiles - b.distanceMiles)
    .slice(0, limit);

  const results = [];
  for (const row of candidates) {
    const fullAddress = [row.address, row.city || "Edina", row.state || "MN", row.zip].filter(Boolean).join(", ");
    try {
      // Omit productIds deliberately: EagleView returns everything this organization is entitled to,
      // letting the 26-day evaluation discover which packs add real signal without failing on a single
      // unauthorized optional pack.
      const submitted = await requestPropertyData({ address: fullAddress, lat: row.lat, lon: row.lon });
      const requestId = findRequestId(submitted);
      let property = null;
      if (requestId) property = await pollResult(requestId);
      const images = property ? extractPropertyImages(property) : [];

      await supabase.from("batch_leads").update({
        image_evidence_status: images.length ? "verified" : "requested",
        image_fetched_at: images.length ? new Date().toISOString() : row.image_fetched_at,
      }).eq("id", row.id);

      results.push({
        id: row.id,
        address: fullAddress,
        distanceMiles: Number(row.distanceMiles.toFixed(3)),
        priorityScore: row.priority_score,
        requestId,
        completed: Boolean(property),
        imageCount: images.length,
        imageTokens: images.map((x) => x.token),
        property,
      });
    } catch (e) {
      results.push({ id: row.id, address: fullAddress, distanceMiles: Number(row.distanceMiles.toFixed(3)), priorityScore: row.priority_score, error: e?.message || String(e) });
    }
  }

  return Response.json({
    ok: true,
    campaign: "edina-interlachen-radius",
    campaignEnd: CAMPAIGN_END.toISOString(),
    environment: cfg.environment,
    anchor: { ...anchor, requested: requestedAnchor, used: anchorUsed },
    radiusMiles,
    dailyLimit: limit,
    candidatesInRadius: inRadius.length,
    processed: results.length,
    successful: results.filter((r) => !r.error).length,
    withImages: results.filter((r) => r.imageCount > 0).length,
    results,
  });
}

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch {}
  return run(req, body);
}

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return run(req, {});
}
