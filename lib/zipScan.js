// Shared ZIP-scan logic: OpenStreetMap Overpass address discovery + optional
// USPS validation. Used by both the interactive /api/zip-scan endpoint and
// the autonomous /api/auto-scan cron job, so the two stay in sync instead of
// drifting into two copies of the same query logic.

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export async function runOverpassQuery(query) {
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

export const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR", "VI", "GU", "AS", "MP",
]);

// Cheap country check on the OSM tags themselves — NOT an area["ISO3166-1"=...]
// query, which is a well-known expensive pattern in Overpass (computing a
// country-sized polygon intersection reliably times out / returns nothing for
// real US ZIPs). Matches on addr:country when present, otherwise requires a
// recognized US state/territory abbreviation in addr:state.
export function looksUS(tags) {
  const country = (tags["addr:country"] || "").toUpperCase();
  if (country) return country === "US" || country === "USA";
  return US_STATES.has((tags["addr:state"] || "").toUpperCase());
}

// Bounded concurrency so a large scan doesn't fire everything at once.
export async function mapWithConcurrency(items, limit, fn) {
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

// Returns { ok, addresses: [{address, lat, lon, houseNum, street, city, state}], city, state, error, debug }
export async function scanZipForAddresses(zip, max) {
  if (!/^\d{5}$/.test(zip)) {
    return { ok: false, error: "Invalid ZIP code." };
  }

  const query = `[out:json][timeout:25];
(
  node["addr:postcode"="${zip}"]["addr:housenumber"];
  way["addr:postcode"="${zip}"]["addr:housenumber"];
);
out center ${max * 3};`;

  const data = await runOverpassQuery(query);
  if (!data) {
    return { ok: false, error: "Address lookup service unavailable — try again shortly.", debug: ["Overpass API unreachable on all mirrors."] };
  }

  const seen = new Set();
  const candidates = [];
  let city = null, state = null;

  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const houseNum = tags["addr:housenumber"];
    const street = tags["addr:street"];
    if (!houseNum || !street) continue;
    if (!looksUS(tags)) continue;

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
    return { ok: false, error: "No addressed buildings found for this ZIP in OpenStreetMap.", debug: [`0 usable elements for addr:postcode=${zip}`, `${(data.elements || []).length} raw element(s) returned before filtering`] };
  }

  return { ok: true, zip, city, state, addresses: candidates };
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

async function uspsValidateOne(token, { houseNum, street, city, state, zip }) {
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

// Validates a batch of {houseNum, street, city, state, zip} candidates against
// USPS (if USPS_CLIENT_ID/SECRET are configured). Returns a parallel array of
// standardized address strings (or null per-item when unconfirmed/unconfigured).
export async function uspsValidateBatch(candidates, zip) {
  const clientId = process.env.USPS_CLIENT_ID;
  const clientSecret = process.env.USPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { verified: candidates.map(() => null), note: null };

  const token = await getUspsToken(clientId, clientSecret);
  if (!token) return { verified: candidates.map(() => null), note: "USPS token request failed — check USPS_CLIENT_ID/USPS_CLIENT_SECRET." };

  const verified = await mapWithConcurrency(candidates, 5, (c) => uspsValidateOne(token, { houseNum: c.houseNum, street: c.street, city: c.city, state: c.state, zip }));
  return { verified, note: `USPS: confirmed ${verified.filter(Boolean).length}/${candidates.length} address(es).` };
}

// Finds distinct nearby postcodes within a metro-scale radius of a point —
// used by the autonomous scanner to expand outward from a seed ZIP without a
// hardcoded ZIP list. `stateFilter` (two-letter, e.g. "MN") keeps expansion
// inside the target state instead of drifting across state lines.
export async function findNeighborZips(lat, lon, radiusM, stateFilter) {
  const query = `[out:json][timeout:25];
node(around:${radiusM},${lat},${lon})["addr:postcode"]["addr:state"="${stateFilter}"];
out tags ${2000};`;

  const data = await runOverpassQuery(query);
  if (!data) return [];

  const zips = new Set();
  for (const el of data.elements || []) {
    const zip = el.tags?.["addr:postcode"];
    if (zip && /^\d{5}$/.test(zip)) zips.add(zip);
  }
  return [...zips];
}
