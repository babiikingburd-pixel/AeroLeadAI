// Multi-angle imagery, server-side (avoids browser CORS issues).
// Produces: tight parcel-cropped overview, mid-range overview for context,
// and a full multi-vantage street-level sweep (multiple panorama points,
// multiple headings, and multiple pitches so roofline is actually visible
// looking up, not just flat street-level shots).
//
// Provider chain, chosen automatically — no manual switching required:
//   Satellite overview:  GOOGLE_MAPS_API_KEY > MAPBOX_TOKEN > Esri World
//                         Imagery (default — free, no key, no signup, works
//                         the moment this app is deployed with zero config).
//   Street-level sweep:  GOOGLE_MAPS_API_KEY (best: real panoramas, full
//                         heading/pitch control) > MAPILLARY_TOKEN (free,
//                         no-card signup at mapillary.com/dashboard, but
//                         crowd-sourced coverage so some addresses have
//                         none) > skipped with a clear note.
//
// Esri's World Imagery is a public, keyless ArcGIS REST export service
// (server.arcgisonline.com) — same "no billing account" spirit as the
// Census/Nominatim/county-GIS lookups already used elsewhere in this app.
// Its resolution varies by area (it's a composite of Maxar, USDA NAIP, and
// other sources) — usually well under 1m/pixel in US suburban/urban areas,
// occasionally coarser in rural spots. Good enough to run the pipeline
// end-to-end with zero setup; add a Google or Mapbox key later for
// guaranteed-fresh, uniform-resolution imagery.

function metersToDegLat(m) { return m / 111320; }
function metersToDegLon(m, atLat) { return m / (111320 * Math.cos((atLat * Math.PI) / 180)); }

function esriExportUrl(lat, lon, halfWidthMeters) {
  const dLat = metersToDegLat(halfWidthMeters);
  const dLon = metersToDegLon(halfWidthMeters, lat);
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(",");
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=640,640&format=jpg&f=image`;
}

async function fetchMapillaryVantages(lat, lon, token) {
  // Small bbox (~70m) around the point; crowd-sourced coverage means results
  // can be empty in many spots — that's expected, not an error.
  const d = 0.00065;
  const bbox = [lon - d, lat - d, lon + d, lat + d].join(",");
  const url = `https://graph.mapillary.com/images?access_token=${token}&fields=id,thumb_2048_url,compass_angle,geometry&bbox=${bbox}&limit=12`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { images: [], note: `Mapillary lookup HTTP ${res.status}` };
    const data = await res.json();
    const items = (data?.data || []).filter((im) => im.thumb_2048_url);
    if (!items.length) return { images: [], note: "No Mapillary street-level coverage found near this property." };
    // Closest-first by simple planar distance (fine at this scale).
    items.sort((a, b) => {
      const da = a.geometry ? (a.geometry.coordinates[0] - lon) ** 2 + (a.geometry.coordinates[1] - lat) ** 2 : Infinity;
      const db = b.geometry ? (b.geometry.coordinates[0] - lon) ** 2 + (b.geometry.coordinates[1] - lat) ** 2 : Infinity;
      return da - db;
    });
    return { images: items.slice(0, 4), note: `Found ${items.length} Mapillary photo(s) nearby, using closest ${Math.min(4, items.length)}.` };
  } catch (e) {
    return { images: [], note: "Mapillary lookup failed: " + e.message };
  }
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

export async function POST(req) {
  const { lat, lon } = await req.json();
  if (!lat || !lon) return Response.json({ error: "lat/lon required" }, { status: 400 });

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const mapboxKey = process.env.MAPBOX_TOKEN;
  const mapillaryToken = process.env.MAPILLARY_TOKEN;
  // No "no provider configured" bail-out anymore — Esri World Imagery below
  // is free and keyless, so satellite overview always runs autonomously.

  const result = { angles: {}, sweep: [], notes: [] };

  // TWO overview shots at different zoom: a tight parcel-cropped shot, as
  // close as the provider allows — isolates the single structure instead of
  // showing 3 neighboring houses — AND a context shot so the model can still
  // see lot boundaries/neighbors when useful, without the tight shot being
  // the only option.
  const tightUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=21&size=640x640&scale=2&maptype=satellite&key=${googleKey}`
    : mapboxKey
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},20,0/640x640@2x?access_token=${mapboxKey}`
    : esriExportUrl(lat, lon, 30); // ~60m-wide frame, tight parcel crop
  const contextUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=19&size=640x640&scale=2&maptype=satellite&key=${googleKey}`
    : mapboxKey
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},18,0/640x640@2x?access_token=${mapboxKey}`
    : esriExportUrl(lat, lon, 120); // ~240m-wide frame, neighborhood context
  // Hybrid overlay (Google only): satellite + parcel/road/label layer, which
  // is the closest free source gets to a property-line reference — actual
  // parcel polygons need county GIS, but road+label overlay at minimum shows
  // where the lot sits relative to the street, unlike bare satellite.
  const hybridUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=20&size=640x640&scale=2&maptype=hybrid&key=${googleKey}`
    : null;

  const overviewProvider = googleKey ? "google" : mapboxKey ? "mapbox" : "esri";

  try {
    const tight = await fetchAsDataUrl(tightUrl, 1);
    if (tight) {
      result.angles.overview_tight = tight;
      result.dataUrl = tight; // backward-compat: tight crop is now the primary
      result.provider = overviewProvider;
    } else {
      result.notes.push("Tight overview fetch failed.");
    }
    const context = await fetchAsDataUrl(contextUrl, 1);
    if (context) result.angles.overview_context = context;
    if (hybridUrl) {
      const hybrid = await fetchAsDataUrl(hybridUrl, 1);
      if (hybrid) result.angles.overview_hybrid_labeled = hybrid;
    }
    if (overviewProvider === "esri") {
      result.notes.push("Satellite imagery from Esri World Imagery (free, keyless). Resolution varies by area — add GOOGLE_MAPS_API_KEY or MAPBOX_TOKEN for guaranteed-fresh, uniform-resolution shots.");
    }
  } catch (e) {
    result.notes.push("Overview imagery error: " + e.message);
  }

  if (googleKey) {
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
          // Heading sweep (left/center/right) AND pitch sweep (level + looking
          // up toward the roofline) — flat street-level shots miss roof damage
          // entirely; pitch 25-30 actually gets the roof in frame from close range.
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
  } else if (mapillaryToken) {
    // Free alternative: Mapillary is crowd-sourced street-level photography.
    // No pitch/heading control like Street View (whatever angle the photo
    // was captured at is what you get), and coverage is patchy outside
    // well-mapped areas, but it's a genuine no-cost option where Google
    // billing setup is a blocker.
    try {
      const { images, note } = await fetchMapillaryVantages(lat, lon, mapillaryToken);
      result.notes.push(note);
      let i = 0;
      for (const im of images) {
        i++;
        const img = await fetchAsDataUrl(im.thumb_2048_url, 1);
        if (img) {
          const key = `mapillary_vantage${i}`;
          result.angles[key] = img;
          result.sweep.push({ key, heading: im.compass_angle ?? null, source: "mapillary" });
        }
      }
    } catch (e) {
      result.notes.push("Mapillary sweep error: " + e.message);
    }
  } else {
    result.notes.push("Street-level sweep needs GOOGLE_MAPS_API_KEY (best quality) or the free MAPILLARY_TOKEN (console.mapillary.com — no card needed, but crowd-sourced coverage so some addresses have none).");
  }

  result.notes.push("Parcel boundary lines require county GIS data (jurisdiction-specific, not a single national API) — the hybrid overlay shot shows road/label context as the closest free proxy. True elevated oblique (~45° looking down) still needs a paid aerial vendor.");

  return Response.json(result);
}
