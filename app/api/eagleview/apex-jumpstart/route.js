import { supabaseServer } from "../../../../lib/supabaseServer";
import { eagleViewConfig, eagleViewConfigured, requestPropertyData, findRequestId, getPropertyResult, extractPropertyImages } from "../../../../lib/eagleview";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ONE_TIME = "b4c1c20e-0ad4-4b65-8810-e38d8ad9d03f";
const ANCHOR = "4300 Interlachen Blvd, Edina, MN 55436";
const FALLBACK = "Vernon Ave S & Interlachen Blvd, Edina, MN 55436";
const LIMIT = 50;
const RADIUS_MILES = 2;

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
  return { lat: Number(data.lat), lon: Number(data.lon), matchedAddress: data.matchedAddress || address };
}

async function poll(requestId) {
  for (let i = 0; i < 5; i++) {
    const result = await getPropertyResult(requestId);
    if (result.status === 200) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return null;
}

export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get("run") !== ONE_TIME) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  if (!eagleViewConfigured()) return Response.json({ ok: false, error: "EagleView not configured" }, { status: 500 });
  const cfg = eagleViewConfig();
  if (cfg.environment !== "production") {
    return Response.json({ ok: false, blocked: true, environment: cfg.environment, reason: "Edina requires EagleView production access" }, { status: 409 });
  }

  const origin = url.origin;
  let anchor = await geocode(origin, ANCHOR);
  let anchorUsed = ANCHOR;
  if (!anchor) { anchor = await geocode(origin, FALLBACK); anchorUsed = FALLBACK; }
  if (!anchor) return Response.json({ ok: false, error: "Could not geocode Edina anchor" }, { status: 422 });

  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured" }, { status: 500 });

  const latDelta = RADIUS_MILES / 69;
  const lonDelta = RADIUS_MILES / (69 * Math.max(Math.cos(anchor.lat * Math.PI / 180), 0.2));
  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("id,address,city,state,zip,lat,lon,priority_score,confidence_score,image_evidence_status,image_fetched_at")
    .gte("lat", anchor.lat - latDelta)
    .lte("lat", anchor.lat + latDelta)
    .gte("lon", anchor.lon - lonDelta)
    .lte("lon", anchor.lon + lonDelta)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const candidates = (rows || [])
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
    .map((r) => ({ ...r, distanceMiles: haversineMiles(anchor.lat, anchor.lon, r.lat, r.lon) }))
    .filter((r) => r.distanceMiles <= RADIUS_MILES)
    .sort((a, b) => (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0) || a.distanceMiles - b.distanceMiles)
    .slice(0, LIMIT);

  const results = [];
  for (const row of candidates) {
    const fullAddress = [row.address, row.city || "Edina", row.state || "MN", row.zip].filter(Boolean).join(", ");
    try {
      const submitted = await requestPropertyData({ address: fullAddress, lat: row.lat, lon: row.lon });
      const requestId = findRequestId(submitted);
      const property = requestId ? await poll(requestId) : null;
      const images = property ? extractPropertyImages(property) : [];

      await supabase.from("batch_leads").update({
        enrichment_queue: "priority",
        image_evidence_status: images.length ? "verified" : "requested",
        image_fetched_at: images.length ? new Date().toISOString() : row.image_fetched_at,
      }).eq("id", row.id);

      results.push({ id: row.id, address: fullAddress, priorityScore: row.priority_score, distanceMiles: Number(row.distanceMiles.toFixed(3)), requestId, completed: Boolean(property), imageCount: images.length });
    } catch (e) {
      results.push({ id: row.id, address: fullAddress, priorityScore: row.priority_score, distanceMiles: Number(row.distanceMiles.toFixed(3)), error: e?.message || String(e) });
    }
  }

  return Response.json({
    ok: true,
    campaign: "apex-roofing",
    category: "Apex Roofing",
    anchor: { ...anchor, used: anchorUsed },
    radiusMiles: RADIUS_MILES,
    requested: LIMIT,
    processed: results.length,
    successful: results.filter((r) => !r.error).length,
    withImages: results.filter((r) => r.imageCount > 0).length,
    results,
  });
}
