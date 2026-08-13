export const dynamic = "force-dynamic";

export const maxDuration = 45;

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function fetchActiveAlerts(lat, lng) {
  const res = await fetchWithTimeout(
    `https://api.weather.gov/alerts/active?point=${lat},${lng}`,
    { headers: { "User-Agent": "AeroLeadAI-StormScan/1.0 (ops@aeroleadai.com)", Accept: "application/geo+json" } },
    10000
  );
  if (!res || !res.ok) return [];
  const data = await res.json();
  return data.features || [];
}

// Offsets a lat/lng point by `miles` in a compass direction, for sampling
// a handful of points across the radius (NOAA alerts don't expose ZIPs
// directly, so ZIPs are derived by reverse-geocoding sample points).
function offsetPoint(lat, lng, miles, bearingDeg) {
  const R = 3958.8; // earth radius in miles
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(miles / R) + Math.cos(lat1) * Math.sin(miles / R) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(miles / R) * Math.cos(lat1), Math.cos(miles / R) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

async function reverseGeocodeZip(lat, lng) {
  const res = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`,
    { headers: { "User-Agent": "AeroLeadAI-StormScan/1.0 (ops@aeroleadai.com)" } },
    8000
  );
  if (!res || !res.ok) return null;
  const data = await res.json();
  return data.address?.postcode || null;
}

async function findAffectedZips(lat, lng, radiusMiles) {
  const points = [{ lat, lng }];
  const bearings = [0, 90, 180, 270];
  for (const b of bearings) points.push(offsetPoint(lat, lng, radiusMiles, b));

  const zips = new Set();
  for (const p of points) {
    const zip = await reverseGeocodeZip(p.lat, p.lng);
    if (zip) zips.add(zip.slice(0, 5));
  }
  return [...zips];
}

export async function POST(req) {
  try {
    const body = await req.json();
    const lat = parseFloat(body.lat);
    const lng = parseFloat(body.lng);
    const radius = parseFloat(body.radius) || 10;
    const eventType = (body.eventType || "").toLowerCase();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ triggered: false, error: "lat and lng are required." }, { status: 400 });
    }

    const alerts = await fetchActiveAlerts(lat, lng);
    const matching = eventType
      ? alerts.filter((a) => (a.properties?.event || "").toLowerCase().includes(eventType))
      : alerts;

    if (matching.length === 0) {
      return Response.json({ triggered: false, affectedZips: [], leadsQueued: 0, note: "No matching active NOAA alerts for this point." });
    }

    const affectedZips = await findAffectedZips(lat, lng, radius);

    let leadsQueued = 0;
    const origin = new URL(req.url).origin;
    for (const zip of affectedZips) {
      try {
        const res = await fetch(`${origin}/api/scan/continuous`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ zipCode: zip, batchSize: 4 }),
        });
        const data = await res.json();
        if (data.success) leadsQueued += data.leads?.length || 0;
      } catch {
        // one zip failing shouldn't stop the rest
      }
    }

    return Response.json({
      triggered: true,
      affectedZips,
      leadsQueued,
      alerts: matching.map((a) => ({ event: a.properties?.event, headline: a.properties?.headline })),
    });
  } catch (e) {
    return Response.json({ triggered: false, error: e.message }, { status: 500 });
  }
}
