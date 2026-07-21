// Multi-angle imagery, server-side (avoids browser CORS issues).
// Produces: tight parcel-cropped overview, mid-range overview for context,
// and a full multi-vantage Street View sweep (multiple panorama points,
// multiple headings, and multiple pitches so roofline is actually visible
// looking up, not just flat street-level shots).
//
// All the individual image/metadata fetches below are independent of each
// other, so they're issued concurrently (Promise.all) rather than one after
// another — sequentially this route could easily issue 15-20+ round trips to
// Google, which blows past Vercel's default serverless timeout and gets the
// whole request killed before any imagery comes back.
export const maxDuration = 60;

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

  if (!googleKey && !mapboxKey) {
    return Response.json({ error: "No imagery provider configured", notes: "Set GOOGLE_MAPS_API_KEY or MAPBOX_TOKEN." }, { status: 200 });
  }

  const result = { angles: {}, sweep: [], notes: [] };

  // TWO overview shots at different zoom: a tight parcel-cropped shot (zoom 20
  // — one below Google Static Maps' max of 21, since zoom 21 satellite tiles
  // aren't actually rendered at that resolution in most areas and come back
  // blurry/upscaled) AND a context shot (zoom 18) so the model can still see
  // lot boundaries/neighbors, and so a few tens of meters of geocode error
  // doesn't put the target parcel outside the crop entirely.
  const tightUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${googleKey}`
    : `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},19,0/640x640@2x?access_token=${mapboxKey}`;
  const contextUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=18&size=640x640&scale=2&maptype=satellite&key=${googleKey}`
    : `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},17,0/640x640@2x?access_token=${mapboxKey}`;
  // Hybrid overlay (Google only): satellite + parcel/road/label layer, which
  // is the closest free source gets to a property-line reference — actual
  // parcel polygons need county GIS, but road+label overlay at minimum shows
  // where the lot sits relative to the street, unlike bare satellite.
  const hybridUrl = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=19&size=640x640&scale=2&maptype=hybrid&key=${googleKey}`
    : null;

  try {
    const [tight, context, hybrid] = await Promise.all([
      fetchAsDataUrl(tightUrl, 1),
      fetchAsDataUrl(contextUrl, 1),
      hybridUrl ? fetchAsDataUrl(hybridUrl, 1) : Promise.resolve(null),
    ]);
    if (tight) {
      result.angles.overview_tight = tight;
      result.dataUrl = tight; // backward-compat: tight crop is now the primary
      result.provider = googleKey ? "google" : "mapbox";
    } else {
      result.notes.push("Tight overview fetch failed.");
    }
    if (context) result.angles.overview_context = context;
    if (hybrid) result.angles.overview_hybrid_labeled = hybrid;
  } catch (e) {
    result.notes.push("Overview imagery error: " + e.message);
  }

  if (googleKey) {
    try {
      const probeBearings = [0, 90, 180, 270];
      const metas = await Promise.all([
        ...probeBearings.map((b) => {
          const probe = destPoint(lat, lon, b, 40);
          return getStreetViewMeta(probe.lat, probe.lon, googleKey);
        }),
        getStreetViewMeta(lat, lon, googleKey),
      ]);
      const panoPoints = new Map();
      for (const meta of metas) {
        if (meta && meta.panoId && !panoPoints.has(meta.panoId)) panoPoints.set(meta.panoId, meta);
      }

      if (panoPoints.size === 0) {
        result.notes.push("No Street View coverage found around this property.");
      } else {
        // Build every shot request across every vantage point up front so
        // they can all be fetched concurrently instead of one at a time.
        const shotJobs = [];
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
            shotJobs.push({ panoIndex, panoId, pano, ...s });
          }
        }

        const images = await Promise.all(
          shotJobs.map((job) =>
            fetchAsDataUrl(`https://maps.googleapis.com/maps/api/streetview?size=640x480&pano=${job.panoId}&heading=${job.heading.toFixed(0)}&pitch=${job.pitch}&fov=75&key=${googleKey}`, 1)
          )
        );

        shotJobs.forEach((job, i) => {
          const img = images[i];
          if (!img) return;
          const key = `vantage${job.panoIndex}_${job.label}`;
          result.angles[key] = img;
          result.sweep.push({ key, panoId: job.panoId, heading: Math.round(job.heading), pitch: job.pitch, vantageLat: job.pano.lat, vantageLon: job.pano.lon });
        });

        result.notes.push(`Swept ${panoPoints.size} public vantage point(s), including a roofline-pitched shot per vantage (${result.sweep.length} total street-level images).`);
      }
    } catch (e) {
      result.notes.push("Street View sweep error: " + e.message);
    }
  } else {
    result.notes.push("Street-level sweep requires GOOGLE_MAPS_API_KEY (Mapbox has no street-view equivalent).");
  }

  result.notes.push("Parcel boundary lines require county GIS data (jurisdiction-specific, not a single national API) — the hybrid overlay shot shows road/label context as the closest free proxy. True elevated oblique (~45° looking down) still needs a paid aerial vendor.");

  return Response.json(result);
}
