// Shared address-discovery core used by /api/zip-scan (existing) and the new
// /api/discover (city/county/polygon). Kept in one place so all discovery
// modes share the same mirrors, timeouts, and dedup logic.
export async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  catch { return null; }
  finally { clearTimeout(id); }
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const UA = "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app; contact: ops@aeroleadai.com)";

async function overpassQuery(query) {
  let lastStatus = null;
  for (const mirror of OVERPASS_MIRRORS) {
    const res = await fetchWithTimeout(mirror, { method: "POST", headers: { "Content-Type": "text/plain", "User-Agent": UA }, body: query }, 15000);
    if (res && res.ok) return res.json();
    lastStatus = res?.status ?? "no response";
  }
  throw new Error(`Overpass unreachable (all mirrors, last: ${lastStatus})`);
}

function dedupAddresses(list, max) {
  const seen = new Set(), out = [];
  for (const a of list) {
    const k = a.address.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

function elementsToAddresses(elements, fallbackCity, fallbackState) {
  const out = [];
  for (const el of elements || []) {
    const t = el.tags || {};
    const num = t["addr:housenumber"], street = t["addr:street"];
    if (!num || !street) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    out.push({
      address: `${num} ${street}, ${t["addr:city"] || fallbackCity}, ${t["addr:state"] || fallbackState}`.replace(/, $/, ""),
      lat: lat ? String(lat) : null, lon: lon ? String(lon) : null,
    });
  }
  return out;
}

// Discover addresses within a radius of a center point (used by city/county
// mode after geocoding the place name).
export async function discoverByRadius(centerLat, centerLon, radiusM, max, city = "", state = "") {
  const query = `[out:json][timeout:20];(node["addr:housenumber"]["addr:street"](around:${radiusM},${centerLat},${centerLon});way["addr:housenumber"]["addr:street"](around:${radiusM},${centerLat},${centerLon}););out center ${max * 2};`;
  const data = await overpassQuery(query);
  return dedupAddresses(elementsToAddresses(data.elements, city, state), max);
}

// Discover addresses inside an arbitrary drawn polygon (lat,lon pairs).
export async function discoverByPolygon(points, max, city = "", state = "") {
  const poly = points.map((p) => `${p.lat} ${p.lon}`).join(" ");
  const query = `[out:json][timeout:25];(node["addr:housenumber"]["addr:street"](poly:"${poly}");way["addr:housenumber"]["addr:street"](poly:"${poly}"););out center ${max * 2};`;
  const data = await overpassQuery(query);
  return dedupAddresses(elementsToAddresses(data.elements, city, state), max);
}

// Resolve a free-text city/county name to a center point + bounding radius
// via Nominatim (keyless). Returns null if not found.
export async function geocodePlace(query) {
  const res = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1&polygon_geojson=0`,
    { headers: { "User-Agent": UA, "Accept-Language": "en" } }, 10000
  );
  if (!res || !res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  const d = data[0];
  const bbox = d.boundingbox?.map(Number); // [south, north, west, east]
  let radiusM = 3000;
  if (bbox) {
    const dLat = Math.abs(bbox[1] - bbox[0]) * 111000;
    const dLon = Math.abs(bbox[3] - bbox[2]) * 111000 * Math.cos((+d.lat * Math.PI) / 180);
    radiusM = Math.min(Math.max(dLat, dLon) / 2, 15000); // cap at 15km so Overpass stays fast
  }
  return { lat: +d.lat, lon: +d.lon, radiusM, city: d.address?.city || d.address?.town || d.address?.county || d.name, state: d.address?.state_code || d.address?.state || "" };
}
