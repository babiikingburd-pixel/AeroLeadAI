// Autonomous ZIP-code address scan, server-side (avoids browser CORS).
// Pulls addressed buildings from OpenStreetMap's Overpass API — free, no key,
// no paid parcel vendor required. Real coverage depends on how well that ZIP
// is mapped in OSM; sparsely-mapped areas will legitimately return few/none
// (surfaced via `error`/`debug` rather than pretending success).

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function runOverpassQuery(query) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" },
        body: query,
      });
      if (res.ok) return await res.json();
    } catch (_) { /* try next mirror */ }
  }
  return null;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const zip = (searchParams.get("zip") || "").trim();
  const max = Math.min(parseInt(searchParams.get("max"), 10) || 50, 200);

  if (!/^\d{5}$/.test(zip)) {
    return Response.json({ ok: false, error: "Enter a valid 5-digit ZIP code." });
  }

  // Scoped to the US — OSM postcode tags aren't globally unique (e.g. "10001"
  // also exists in Spain), and this app is US-only end to end (Census geocoder,
  // US permit rules, US structural codes), so an unscoped match would silently
  // pull addresses from the wrong country.
  const query = `[out:json][timeout:25];
area["ISO3166-1"="US"][admin_level=2]->.us;
(
  node(area.us)["addr:postcode"="${zip}"]["addr:housenumber"];
  way(area.us)["addr:postcode"="${zip}"]["addr:housenumber"];
);
out center ${max * 3};`;

  const data = await runOverpassQuery(query);
  if (!data) {
    return Response.json({ ok: false, error: "Address lookup service unavailable — try again shortly.", debug: ["Overpass API unreachable on all mirrors."] });
  }

  const seen = new Set();
  const addresses = [];
  let city = null, state = null;

  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const houseNum = tags["addr:housenumber"];
    const street = tags["addr:street"];
    if (!houseNum || !street) continue;

    const address = `${houseNum} ${street}, ${tags["addr:city"] || ""} ${tags["addr:state"] || ""} ${zip}`.replace(/\s+/g, " ").trim();
    if (seen.has(address)) continue;
    seen.add(address);

    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    addresses.push({ address, lat, lon });

    if (!city && tags["addr:city"]) city = tags["addr:city"];
    if (!state && tags["addr:state"]) state = tags["addr:state"];
    if (addresses.length >= max) break;
  }

  if (addresses.length === 0) {
    return Response.json({ ok: false, error: "No addressed buildings found for this ZIP in OpenStreetMap.", debug: [`0 usable elements for addr:postcode=${zip}`, `${(data.elements || []).length} raw element(s) returned before filtering`] });
  }

  return Response.json({ ok: true, zip, city, state, count: addresses.length, addresses });
}
