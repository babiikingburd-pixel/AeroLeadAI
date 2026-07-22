// Multi-angle imagery, server-side (avoids browser CORS issues).
// Produces: tight parcel-cropped overview, mid-range overview for context,
// and a full multi-vantage Street View sweep (multiple panorama points,
// multiple headings, and multiple pitches so roofline is actually visible
// looking up, not just flat street-level shots).
//
// Provider fallback: tries Google (if GOOGLE_MAPS_API_KEY set) -> Mapbox (if
// MAPBOX_TOKEN set) -> Esri World Imagery (free, no key, always available)
// in order, moving to the next provider only if the current one's overview
// shots both fail outright (quota exceeded, network error, etc). Whole
// providers are swapped rather than mixing angle sources mid-response, so a
// single response is never a patchwork of different providers' zoom levels.
//
// Caching: when Supabase is configured (NEXT_PUBLIC_SUPABASE_URL + a key),
// results are cached by rounded lat/lon so repeat requests for the same
// property don't re-hit the imagery APIs. Every genuinely fresh fetch is
// also appended to an imagery_history log (not overwritten), which is what
// powers before/after comparison in the console. See
// supabase_batch_leads_schema.sql for both tables. Without Supabase
// configured, caching is skipped entirely — same as before.

const CACHE_TTL_MS = 30 * 24 * 3600 * 1000; // satellite/street imagery doesn't change often

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function cacheKeyFor(lat, lon) {
  return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
}

async function readCache(cfg, key) {
  try {
    const res = await fetch(`${cfg.url}/rest/v1/imagery_cache?key=eq.${encodeURIComponent(key)}&select=*&limit=1`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = rows[0];
    if (!row) return null;
    if (Date.now() - new Date(row.fetched_at).getTime() > CACHE_TTL_MS) return null;
    return row;
  } catch (_) {
    return null;
  }
}

async function writeCache(cfg, key, lat, lon, payload) {
  const record = {
    key, lat: Number(lat), lon: Number(lon),
    provider: payload.provider || null,
    angles: payload.angles, resolution: payload.resolution,
    fetched_at: new Date().toISOString(),
  };
  try {
    await fetch(`${cfg.url}/rest/v1/imagery_cache`, {
      method: "POST",
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(record),
    });
  } catch (_) {}
  try {
    await fetch(`${cfg.url}/rest/v1/imagery_history`, {
      method: "POST",
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{ key, lat: Number(lat), lon: Number(lon), provider: payload.provider || null, angles: payload.angles, resolution: payload.resolution, fetched_at: record.fetched_at }]),
    });
  } catch (_) {}
}

function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destPoint(lat, lon, bearingDeg, distanceM) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const br = toRad(bearingDeg);
  const lat1 = toRad(lat), lon1 = toRad(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceM / R) + Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(distanceM / R) * Math.cos(lat1), Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

// Standard Web Mercator ground resolution formula (256px base tile), divided
// by `scale` for retina/@2x requests. This is the real, honest number —
// unlike capture date, resolution IS derivable from the request parameters
// themselves for tile-based providers.
function metersPerPixelMercator(lat, zoom, scale = 1) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom * scale);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchAsDataUrl(url, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const mediaType = res.headers.get("content-type") || "image/jpeg";
        return `data:${mediaType};base64,${Buffer.from(buf).toString("base64")}`;
      }
    } catch (_) {}
  }
  return null;
}

async function getStreetViewMeta(lat, lon, key) {
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&key=${key}`);
    const data = await res.json();
    if (data.status === "OK" && data.location) return { lat: data.location.lat, lon: data.location.lng, panoId: data.pano_id };
  } catch (_) {}
  return null;
}

// Try Esri's free World Imagery export — no key, no signup, always
// available as the final fallback. Quality/recency varies vs paid
// providers and there's no street-view equivalent.
async function tryEsri(lat, lon) {
  const result = { angles: {}, resolution: {}, notes: [] };
  const d = 0.0008, dCtx = 0.003; // tight parcel view, wider context view
  const esri = (delta) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon - delta},${lat - delta},${lon + delta},${lat + delta}&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&f=image`;
  const mppFor = (delta) => haversineMeters(lat - delta, lon, lat + delta, lon) / 640;
  const tight = await fetchAsDataUrl(esri(d), 2);
  if (tight) {
    result.angles.overview_tight = tight;
    result.resolution.overview_tight = { source: "esri-free", metersPerPixel: mppFor(d) };
  }
  const ctx = await fetchAsDataUrl(esri(dCtx), 2);
  if (ctx) {
    result.angles.overview_context = ctx;
    result.resolution.overview_context = { source: "esri-free", metersPerPixel: mppFor(dCtx) };
  }
  if (!tight && !ctx) return null;
  result.provider = "esri-free";
  result.dataUrl = tight || ctx;
  result.notes.push("Using Esri World Imagery free tier. Add GOOGLE_MAPS_API_KEY or MAPBOX_TOKEN for higher-recency imagery plus a street-view sweep.");
  return result;
}

async function tryGoogle(lat, lon, googleKey) {
  const result = { angles: {}, sweep: [], resolution: {}, notes: [] };
  const zoomTight = 21, zoomCtx = 19, zoomHybrid = 20, scale = 2;
  const tightUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${zoomTight}&size=640x640&scale=${scale}&maptype=satellite&key=${googleKey}`;
  const contextUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${zoomCtx}&size=640x640&scale=${scale}&maptype=satellite&key=${googleKey}`;
  const hybridUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${zoomHybrid}&size=640x640&scale=${scale}&maptype=hybrid&key=${googleKey}`;

  const tight = await fetchAsDataUrl(tightUrl, 1);
  const context = await fetchAsDataUrl(contextUrl, 1);
  if (!tight && !context) return null; // total provider failure -> let caller fall back

  if (tight) { result.angles.overview_tight = tight; result.resolution.overview_tight = { source: "google", zoom: zoomTight, metersPerPixel: metersPerPixelMercator(lat, zoomTight, scale) }; }
  else result.notes.push("Tight overview fetch failed.");
  if (context) { result.angles.overview_context = context; result.resolution.overview_context = { source: "google", zoom: zoomCtx, metersPerPixel: metersPerPixelMercator(lat, zoomCtx, scale) }; }
  const hybrid = await fetchAsDataUrl(hybridUrl, 1);
  if (hybrid) { result.angles.overview_hybrid_labeled = hybrid; result.resolution.overview_hybrid_labeled = { source: "google", zoom: zoomHybrid, metersPerPixel: metersPerPixelMercator(lat, zoomHybrid, scale) }; }

  result.provider = "google";
  result.dataUrl = tight || context;

  try {
    const probeBearings = [0, 90, 180, 270];
    const panoPoints = new Map();
    for (const b of probeBearings) {
      const probe = destPoint(lat, lon, b, 40);
      const meta = await getStreetViewMeta(probe.lat, probe.lon, googleKey);
      if (meta && meta.panoId && !panoPoints.has(meta.panoId)) panoPoints.set(meta.panoId, meta);
    }
    const direct = await getStreetViewMeta(lat, lon, googleKey);
    if (direct && direct.panoId && !panoPoints.has(direct.panoId)) panoPoints.set(direct.panoId, direct);

    if (panoPoints.size === 0) {
      result.notes.push("No Street View coverage found around this property.");
    } else {
      let panoIndex = 0;
      for (const [panoId, pano] of panoPoints) {
        panoIndex++;
        const headingToTarget = bearingBetween(pano.lat, pano.lon, lat, lon);
        const shots = [
          { label: "facing_level", heading: headingToTarget, pitch: 0 },
          { label: "facing_roofline", heading: headingToTarget, pitch: 28 },
          { label: "left_level", heading: (headingToTarget - 40 + 360) % 360, pitch: 0 },
          { label: "right_level", heading: (headingToTarget + 40) % 360, pitch: 0 },
        ];
        for (const s of shots) {
          const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&pano=${panoId}&heading=${s.heading.toFixed(0)}&pitch=${s.pitch}&fov=75&key=${googleKey}`;
          const img = await fetchAsDataUrl(url, 1);
          if (img) {
            const key = `vantage${panoIndex}_${s.label}`;
            result.angles[key] = img;
            result.sweep.push({ key, panoId, heading: Math.round(s.heading), pitch: s.pitch, vantageLat: pano.lat, vantageLon: pano.lon });
          }
        }
      }
      result.notes.push(`Swept ${panoPoints.size} public vantage point(s), including a roofline-pitched shot per vantage (${result.sweep.length} total street-level images).`);
    }
  } catch (e) {
    result.notes.push("Street View sweep error: " + e.message);
  }

  result.notes.push("Parcel boundary lines require county GIS data — the hybrid overlay shot shows road/label context as the closest free proxy.");
  return result;
}

async function tryMapbox(lat, lon, mapboxKey) {
  const result = { angles: {}, resolution: {}, notes: [] };
  const zoomTight = 20, zoomCtx = 18, scale = 2;
  const tightUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},${zoomTight},0/640x640@2x?access_token=${mapboxKey}`;
  const contextUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},${zoomCtx},0/640x640@2x?access_token=${mapboxKey}`;

  const tight = await fetchAsDataUrl(tightUrl, 1);
  const context = await fetchAsDataUrl(contextUrl, 1);
  if (!tight && !context) return null;

  if (tight) { result.angles.overview_tight = tight; result.resolution.overview_tight = { source: "mapbox", zoom: zoomTight, metersPerPixel: metersPerPixelMercator(lat, zoomTight, scale) }; }
  else result.notes.push("Tight overview fetch failed.");
  if (context) { result.angles.overview_context = context; result.resolution.overview_context = { source: "mapbox", zoom: zoomCtx, metersPerPixel: metersPerPixelMercator(lat, zoomCtx, scale) }; }

  result.provider = "mapbox";
  result.dataUrl = tight || context;
  result.notes.push("Street-level sweep requires GOOGLE_MAPS_API_KEY (Mapbox has no street-view equivalent).");
  return result;
}

// History lookup for before/after comparison: GET /api/imagery-agent?lat=..&lon=..
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat"), lon = searchParams.get("lon");
  if (!lat || !lon) return Response.json({ ok: false, error: "lat/lon required" });
  const supa = supabaseConfig();
  if (!supa) return Response.json({ ok: false, error: "Imagery history requires Supabase to be configured." });
  try {
    const key = cacheKeyFor(lat, lon);
    const res = await fetch(`${supa.url}/rest/v1/imagery_history?key=eq.${encodeURIComponent(key)}&select=fetched_at,provider,angles,resolution&order=fetched_at.desc&limit=20`, {
      headers: { apikey: supa.key, Authorization: `Bearer ${supa.key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return Response.json({ ok: true, snapshots: rows });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}

export async function POST(req) {
  const { lat, lon, force } = await req.json();
  if (!lat || !lon) return Response.json({ error: "lat/lon required" }, { status: 400 });

  const supa = supabaseConfig();
  const key = cacheKeyFor(lat, lon);

  if (supa && !force) {
    const cached = await readCache(supa, key);
    if (cached) {
      return Response.json({
        angles: cached.angles || {}, sweep: [], notes: [`Served from cache (fetched ${cached.fetched_at}).`],
        resolution: cached.resolution || {}, provider: cached.provider, dataUrl: (cached.angles || {}).overview_tight || null,
        capturedDate: null, cached: true, cachedAt: cached.fetched_at,
      });
    }
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const mapboxKey = process.env.MAPBOX_TOKEN;

  let payload = null;
  const attempts = [];
  if (googleKey) attempts.push(() => tryGoogle(lat, lon, googleKey));
  if (mapboxKey) attempts.push(() => tryMapbox(lat, lon, mapboxKey));
  attempts.push(() => tryEsri(lat, lon)); // always last — free, keyless, guaranteed available

  const triedProviders = [];
  for (const attempt of attempts) {
    const r = await attempt();
    if (r) { payload = r; break; }
    triedProviders.push("failed");
  }

  if (!payload) {
    return Response.json({ error: "All imagery providers failed", notes: "Google/Mapbox/Esri all unreachable or returned no image for these coordinates." }, { status: 200 });
  }
  if (triedProviders.length) {
    payload.notes.unshift(`Fell back to ${payload.provider} after ${triedProviders.length} provider(s) failed.`);
  }
  payload.capturedDate = null; // honest gap: none of these static-tile APIs expose per-image capture date
  payload.cached = false;

  if (supa) await writeCache(supa, key, lat, lon, payload);

  return Response.json(payload);
}
