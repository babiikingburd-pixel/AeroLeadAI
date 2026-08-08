import { supabaseServer } from "../../../lib/supabaseServer";
import { SUPPORTED_COUNTIES } from "../../../lib/twincities/propertyValue";

export const maxDuration = 60;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const CANDIDATE_BUFFER = 6;

async function fetchImageBuffer(url, timeoutMs = 9000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) return null;
    return { buffer, contentType };
  } catch (_) {
    return null;
  }
}

async function tryGoogle(lat, lon, key) {
  if (!key) return null;
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=21&size=640x640&scale=2&maptype=satellite&key=${key}`;
  const img = await fetchImageBuffer(url);
  return img ? { ...img, provider: "google", quality: 90 } : null;
}

async function tryMapbox(lat, lon, token) {
  if (!token) return null;
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},20,0/640x640@2x?access_token=${token}`;
  const img = await fetchImageBuffer(url);
  return img ? { ...img, provider: "mapbox", quality: 84 } : null;
}

async function tryEsri(lat, lon) {
  const d = 0.0004;
  const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&compressionQuality=85&f=image`;
  const img = await fetchImageBuffer(url);
  return img ? { ...img, provider: "esri", quality: 72 } : null;
}

// Race providers instead of serially waiting on a dead/slow provider.
// The first valid image wins the fast path; its source is persisted immediately.
async function fetchPropertyImage(lat, lon, googleKey, mapboxKey) {
  let pending = [
    tryGoogle(lat, lon, googleKey),
    tryMapbox(lat, lon, mapboxKey),
    tryEsri(lat, lon),
  ].map((p, id) => ({ id, promise: p.then(v => ({ id, v })).catch(() => ({ id, v: null })) }));

  while (pending.length) {
    const winner = await Promise.race(pending.map(p => p.promise));
    if (winner.v) return winner.v;
    pending = pending.filter(p => p.id !== winner.id);
  }
  return null;
}

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const county = searchParams.get("county");
  const limit = Math.min(Number(searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);
  const counties = county ? [county] : SUPPORTED_COUNTIES;

  // IMPORTANT: this is now the actual Top-500 order, not an arbitrary DB page.
  const { data: candidates, error } = await supabase
    .from("batch_leads")
    .select("id,address,city,county,lat,lon,priority_score,confidence_score")
    .in("county", counties)
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .gt("priority_score", 0)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("priority_score", { ascending: false })
    .order("confidence_score", { ascending: false, nullsFirst: false })
    .limit(limit * CANDIDATE_BUFFER);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const ids = (candidates || []).map(r => r.id);
  const { data: already, error: alreadyError } = ids.length
    ? await supabase.from("property_images").select("property_id").in("property_id", ids)
    : { data: [], error: null };
  if (alreadyError) return Response.json({ ok: false, error: alreadyError.message }, { status: 500 });

  const doneIds = new Set((already || []).map(r => r.property_id));
  const rows = (candidates || []).filter(r => !doneIds.has(r.id)).slice(0, limit);

  if (!rows.length) {
    return Response.json({ ok: true, processed: 0, google: 0, mapbox: 0, esri: 0, failed: 0, note: "Top-ranked candidates in this batch already have imagery." });
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const mapboxKey = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const counts = { google: 0, mapbox: 0, esri: 0, failed: 0 };

  // Small parallelism improves throughput without turning a Vercel request into
  // an uncontrolled fan-out.
  const concurrency = 5;
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(batch.map(async row => {
      const img = await fetchPropertyImage(row.lat, row.lon, googleKey, mapboxKey);
      if (!img) { counts.failed++; return; }

      const ext = img.contentType.includes("png") ? "png" : "jpg";
      const storagePath = `${row.county}/${row.id}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("property-images")
        .upload(storagePath, img.buffer, { contentType: img.contentType, upsert: true });

      if (uploadError) {
        console.error("[image-crawler] storage upload failed", row.id, uploadError.message);
        counts.failed++;
        return;
      }

      const { data: urlData } = supabase.storage.from("property-images").getPublicUrl(storagePath);
      const imageUrl = urlData?.publicUrl ?? null;

      const { error: insertError } = await supabase.from("property_images").insert({
        property_id: row.id,
        county: row.county,
        city: row.city,
        address: row.address,
        provider: img.provider,
        view: "overview_tight",
        storage_path: storagePath,
        image_url: imageUrl,
        image_kind: "property_overview",
        quality_score: img.quality,
        evidence_status: imageUrl ? "fetched" : "failed",
        fetched_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error("[image-crawler] DB image record failed", row.id, insertError.message);
        counts.failed++;
        return;
      }
      counts[img.provider]++;
    }));
  }

  return Response.json({
    ok: true,
    scanned: rows.length,
    processed: counts.google + counts.mapbox + counts.esri,
    google: counts.google,
    mapbox: counts.mapbox,
    esri: counts.esri,
    failed: counts.failed,
    order: "priority_desc_then_confidence_desc",
    note: "Top-ranked candidates were processed first; first usable imagery wins and is persisted immediately.",
  });
}
