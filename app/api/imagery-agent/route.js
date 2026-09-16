import { NextResponse } from "next/server";
import { cachePath, readJson, writeJson } from "../../../../lib/inspect/store";

function esriUrl(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

function streetUrl(lat, lon, heading, pitch, key) {
  if (!key) return null;
  const q = new URLSearchParams({
    size: "640x640",
    location: `${lat},${lon}`,
    heading: String(heading),
    pitch: String(pitch),
    fov: "80",
    source: "outdoor",
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${q}`;
}

async function streetMetadata(lat, lon, key) {
  if (!key) return { status: "NO_KEY" };
  const q = new URLSearchParams({ location: `${lat},${lon}`, source: "outdoor", key });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${q}`, {
    cache: "no-store",
  });
  if (!res.ok) return { status: "HTTP", http: res.status };
  return res.json();
}

function overheadEsri(lat, lon, zoom) {
  return { url: esriUrl(lat, lon, zoom), source: "esri-free" };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const id = searchParams.get("id") || `${lat},${lon}`;
  const paid = searchParams.get("paid") === "1";
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: "lat/lon required" }, { status: 400 });
  }

  const cacheKey = cachePath(`imagery-${paid ? "paid" : "free"}-${id}-${lat.toFixed(5)}-${lon.toFixed(5)}`);
  const cached = await readJson(cacheKey, null);
  if (cached?.shots && Date.now() - cached.fetchedAt < 7 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: true, cached: true, paid, ...cached });
  }

  const shots = {
    overview_tight: overheadEsri(lat, lon, 20),
    overview_context: overheadEsri(lat, lon, 18),
    overview_hybrid_labeled: overheadEsri(lat, lon, 16),
  };

  let meta = { status: "SKIPPED" };
  const key = process.env.GOOGLE_MAPS_API_KEY || "";
  if (paid) {
    meta = await streetMetadata(lat, lon, key);
    const panoOk = meta.status === "OK";
    const panoLoc = panoOk && meta.location ? meta.location : { lat, lng: lon };
    const headings = [
      ["vantage1_facing_roofline", 0, 12],
      ["vantage1_right", 90, 6],
      ["vantage1_rear", 180, 6],
      ["vantage1_left_level", 270, 6],
      ["vantage1_driveway", 40, -18],
    ];
    for (const [k, heading, pitch] of headings) {
      if (!key) {
        shots[k] = { url: null, source: "unavailable", heading, pitch, reason: "NO_KEY" };
        continue;
      }
      if (!panoOk) {
        shots[k] = { url: null, source: "unavailable", heading, pitch, reason: meta.status };
        continue;
      }
      shots[k] = {
        url: streetUrl(panoLoc.lat, panoLoc.lng, heading, pitch, key),
        source: "google",
        heading,
        pitch,
        panoId: meta.pano_id || null,
        panoDate: meta.date || null,
      };
    }
  }

  const payload = {
    lat,
    lon,
    paid,
    fetchedAt: Date.now(),
    streetMeta: { status: meta.status, date: meta.date || null, pano_id: meta.pano_id || null },
    shots,
    providerNote: paid
      ? key
        ? meta.status === "OK"
          ? `Street View pano ${meta.date || meta.pano_id}`
          : `Street View metadata ${meta.status}`
        : "GOOGLE_MAPS_API_KEY missing — Esri overhead only"
      : "Free Esri tiles only. Street View is off until you request paid shots.",
  };
  await writeJson(cacheKey, payload);
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
