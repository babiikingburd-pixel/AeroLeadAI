// Autonomous ZIP-code address scan, server-side (avoids browser CORS).
// Pulls addressed buildings from OpenStreetMap's Overpass API — free, no key,
// no paid parcel vendor required. Real coverage depends on how well that ZIP
// is mapped in OSM; sparsely-mapped areas will legitimately return few/none
// (surfaced via `error`/`debug` rather than pretending success).
//
// Optional USPS deliverability check (set USPS_CLIENT_ID + USPS_CLIENT_SECRET,
// free registration at developer.usps.com): USPS has no public endpoint that
// *lists* every address in a ZIP — that's a paid CASS-licensed bulk product,
// not something a simple API key gets you — so this can't replace the OSM
// scan above. What it CAN do is confirm/standardize each OSM-found address
// against USPS's own database, which is worth having since OSM data is
// crowd-sourced and sometimes stale or wrong. Every address is returned
// either way; `uspsVerified` just tells you which ones USPS could confirm.

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

async function getUspsToken(clientId, clientSecret) {
  try {
    const res = await fetch("https://api.usps.com/oauth2/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "addresses" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch { return null; }
}

async function uspsValidate(token, { houseNum, street, city, state, zip }) {
  try {
    const params = new URLSearchParams({ streetAddress: `${houseNum} ${street}`, ZIPCode: zip });
    if (city) params.set("city", city);
    if (state) params.set("state", state);
    const res = await fetch(`https://api.usps.com/addresses/v3/address?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address;
    if (!a?.streetAddress) return null;
    return `${a.streetAddress}${a.secondaryAddress ? " " + a.secondaryAddress : ""}, ${a.city || city || ""}, ${a.state || state || ""} ${a.ZIPCode || zip}`.replace(/\s+/g, " ").trim();
  } catch { return null; }
}

// Bounded concurrency so a 200-address scan doesn't fire 200 requests at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
  const candidates = [];
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
    candidates.push({ address, lat, lon, houseNum, street, city: tags["addr:city"] || null, state: tags["addr:state"] || null });

    if (!city && tags["addr:city"]) city = tags["addr:city"];
    if (!state && tags["addr:state"]) state = tags["addr:state"];
    if (candidates.length >= max) break;
  }

  if (candidates.length === 0) {
    return Response.json({ ok: false, error: "No addressed buildings found for this ZIP in OpenStreetMap.", debug: [`0 usable elements for addr:postcode=${zip}`, `${(data.elements || []).length} raw element(s) returned before filtering`] });
  }

  const debug = [];
  let addresses = candidates.map(({ address, lat, lon }) => ({ address, lat, lon }));

  const uspsClientId = process.env.USPS_CLIENT_ID;
  const uspsClientSecret = process.env.USPS_CLIENT_SECRET;
  if (uspsClientId && uspsClientSecret) {
    const token = await getUspsToken(uspsClientId, uspsClientSecret);
    if (token) {
      const verified = await mapWithConcurrency(candidates, 5, async (c) => uspsValidate(token, { houseNum: c.houseNum, street: c.street, city: c.city, state: c.state, zip }));
      addresses = candidates.map((c, i) => ({
        address: verified[i] || c.address,
        lat: c.lat, lon: c.lon,
        uspsVerified: !!verified[i],
      }));
      const verifiedCount = verified.filter(Boolean).length;
      debug.push(`USPS: confirmed ${verifiedCount}/${candidates.length} address(es).`);
    } else {
      debug.push("USPS: token request failed — check USPS_CLIENT_ID/USPS_CLIENT_SECRET, falling back to OSM data only.");
    }
  }

  return Response.json({ ok: true, zip, city, state, count: addresses.length, addresses, ...(debug.length ? { debug } : {}) });
}
