import { supabaseServer } from "../../../lib/supabaseServer";
import { SUPPORTED_COUNTIES } from "../../../lib/twincities/propertyValue";

// GET /api/image-crawler?county=hennepin&limit=25
//
// Batch image crawler for the Twin Cities pipeline: pulls batch_leads rows
// (in the requested county, or all six target counties) that don't already
// have a property_images row, fetches one representative overview image per
// property — Google Static Maps satellite -> Mapbox satellite-v9 -> Esri
// World Imagery free tier, same provider priority as /api/imagery-agent —
// uploads it to the "property-images" Supabase Storage bucket, and logs the
// result to property_images. Capped at 50/call so a button click can't
// trigger a runaway scan; defaults to 25.

export const maxDuration = 60;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const CANDIDATE_BUFFER = 4; // over-fetch batch_leads rows since some will already have an image

async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null; // Google/Mapbox return a JSON error body on failure, not an image
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } catch (_) {
    return null;
  }
}

async function tryGoogle(lat, lon, key) {
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=21&size=640x640&scale=2&maptype=satellite&key=${key}`;
  const img = await fetchImageBuffer(url);
  return img ? { ...img, provider: "google" } : null;
}

async function tryMapbox(lat, lon, token) {
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},20,0/640x640@2x?access_token=${token}`;
  const img = await fetchImageBuffer(url);
  return img ? { ...img, provider: "mapbox" } : null;
}

async function tryEsri(lat, lon) {
  const d = 0.0004; // ~90m box, same tight parcel crop as imagery-agent.js
  const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&compressionQuality=70&f=image`;
  const img = await fetchImageBuffer(url);
  return img ? { ...img, provider: "esri" } : null;
}

// Whole providers are tried in order, moving on only if the current one
// returns nothing at all — same fallback shape as imagery-agent.js.
async function fetchPropertyImage(lat, lon, googleKey, mapboxKey) {
  if (googleKey) {
    const img = await tryGoogle(lat, lon, googleKey);
    if (img) return img;
  }
  if (mapboxKey) {
    const img = await tryMapbox(lat, lon, mapboxKey);
    if (img) return img;
  }
  return tryEsri(lat, lon); // always last — free, keyless, guaranteed available
}

export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const county = searchParams.get("county");
  const limit = Math.min(Number(searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);
  const counties = county ? [county] : SUPPORTED_COUNTIES;

  const { data: candidates, error } = await supabase
    .from("batch_leads")
    .select("id, address, city, county, lat, lon")
    .in("county", counties)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(limit * CANDIDATE_BUFFER);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!candidates || candidates.length === 0) {
    return Response.json({ ok: true, processed: 0, google: 0, mapbox: 0, esri: 0, failed: 0, note: "No batch_leads rows with lat/lon in the requested county set." });
  }

  const candidateIds = candidates.map((r) => r.id);
  const { data: already, error: alreadyError } = await supabase
    .from("property_images")
    .select("property_id")
    .in("property_id", candidateIds);
  if (alreadyError) return Response.json({ ok: false, error: alreadyError.message }, { status: 500 });

  const doneIds = new Set((already || []).map((r) => r.property_id));
  const rows = candidates.filter((r) => !doneIds.has(r.id)).slice(0, limit);

  if (rows.length === 0) {
    return Response.json({ ok: true, processed: 0, google: 0, mapbox: 0, esri: 0, failed: 0, note: "All candidate rows in this batch already have images." });
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const mapboxKey = process.env.MAPBOX_TOKEN;
  const counts = { google: 0, mapbox: 0, esri: 0, failed: 0 };

  for (const row of rows) {
    const img = await fetchPropertyImage(row.lat, row.lon, googleKey, mapboxKey);
    if (!img) {
      counts.failed++;
      continue;
    }

    const ext = img.contentType.includes("png") ? "png" : "jpg";
    const storagePath = `${row.county}/${row.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("property-images")
      .upload(storagePath, img.buffer, { contentType: img.contentType, upsert: true });
    if (uploadError) {
      counts.failed++;
      continue;
    }

    const { data: urlData } = supabase.storage.from("property-images").getPublicUrl(storagePath);

    await supabase.from("property_images").insert({
      property_id: row.id,
      county: row.county,
      city: row.city,
      address: row.address,
      provider: img.provider,
      storage_path: storagePath,
      image_url: urlData?.publicUrl ?? null,
    });

    counts[img.provider]++;
  }

  const processed = counts.google + counts.mapbox + counts.esri;

  return Response.json({
    ok: true,
    scanned: rows.length,
    processed,
    google: counts.google,
    mapbox: counts.mapbox,
    esri: counts.esri,
    failed: counts.failed,
  });
}
