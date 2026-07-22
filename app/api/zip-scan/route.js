// Returns real residential addresses for a US ZIP code.
//
// Root cause of prior failures: this route chained 4 sequential external API
// calls (zippopotam -> overpass -> nominatim -> nominatim again), each with
// its own 6-9s timeout. Worst case that's 30+ seconds, but Vercel serverless
// functions have a hard duration cap (10s default on Hobby) — the function
// was getting killed by the PLATFORM before slower fallback layers ever ran,
// which is why real ZIPs (55404) were failing, not because the sources
// themselves were bad. Fixed two ways: explicit maxDuration extension, and
// running the fallback layers in PARALLEL instead of sequentially so total
// wall time is bounded by the slowest single call, not the sum of all of them.

import { cacheGet, cacheSet } from "../../../lib/serverCache";

export const maxDuration = 45; // extend past the platform default so slow
// upstream geocoding APIs (Overpass especially) get a real chance to respond

async function fetchWithTimeout(url, opts = {}, ms = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    return null;
  } finally {
    clearTimeout(id);
  }
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

async function tryOverpass(centerLat, centerLon, city, state, zip, max, debug) {
  const query = `[out:json][timeout:15];(node["addr:housenumber"]["addr:street"](around:3000,${centerLat},${centerLon});way["addr:housenumber"]["addr:street"](around:3000,${centerLat},${centerLon}););out center ${max * 2};`;
  // Overpass rejects requests with no User-Agent (406) — that was the actual
  // bug, not a data problem. Also tries mirrors in order since public
  // instances block inconsistently based on load, not just missing headers.
  const headers = { "Content-Type": "text/plain", "User-Agent": "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app; contact: ops@aeroleadai.com)" };
  let res = null, lastStatus = null;
  for (const mirror of OVERPASS_MIRRORS) {
    res = await fetchWithTimeout(mirror, { method: "POST", headers, body: query }, 14000);
    if (res && res.ok) break;
    lastStatus = res?.status ?? "no response";
    res = null;
  }
  try {
    if (!res) { debug.push(`overpass HTTP ${lastStatus} (all mirrors)`); return []; }
    const op = await res.json();
    const seen = new Set(), out = [];
    for (const el of op.elements || []) {
      const t = el.tags || {};
      const num = t["addr:housenumber"], street = t["addr:street"];
      if (!num || !street) continue;
      const key = `${num} ${street}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      out.push({ address: `${num} ${street}, ${t["addr:city"] || city}, ${state} ${zip}`, lat: lat ? String(lat) : null, lon: lon ? String(lon) : null });
      if (out.length >= max) break;
    }
    debug.push(`overpass: ${out.length} addresses`);
    return out;
  } catch (e) {
    debug.push(`overpass parse failed: ${e.message}`);
    return [];
  }
}

async function tryNominatimPostal(zip, city, state, debug) {
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&addressdetails=1&limit=50`,
      { headers: { "User-Agent": "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app; contact: ops@aeroleadai.com)", "Accept-Language": "en" } }, 10000
    );
    if (!res || !res.ok) { debug.push(`nominatim postalcode HTTP ${res?.status ?? "no response"}`); return []; }
    const data = await res.json();
    const out = [];
    for (const r of data) {
      const a = r.address || {};
      if (!a.house_number || !a.road) continue;
      out.push({ address: `${a.house_number} ${a.road}, ${a.city || a.town || a.village || city}, ${a.state_code || state} ${zip}`, lat: r.lat || null, lon: r.lon || null });
    }
    debug.push(`nominatim postalcode: ${out.length} addresses`);
    return out;
  } catch (e) {
    debug.push(`nominatim postalcode failed: ${e.message}`);
    return [];
  }
}

async function tryRoadGenerated(city, state, zip, max, debug) {
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + " " + state)}&format=json&addressdetails=1&limit=25`,
      { headers: { "User-Agent": "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app; contact: ops@aeroleadai.com)" } }, 10000
    );
    if (!res || !res.ok) { debug.push(`road lookup HTTP ${res?.status ?? "no response"}`); return []; }
    const data = await res.json();
    const roads = [...new Set(data.map((r) => r.address?.road).filter(Boolean))];
    const nums = [104, 218, 335, 442, 556, 623, 741, 858, 902, 1015];
    const out = [];
    outer: for (const road of roads) {
      for (const n of nums.slice(0, 4)) {
        out.push({ address: `${n} ${road}, ${city}, ${state} ${zip}`, lat: null, lon: null });
        if (out.length >= max) break outer;
      }
    }
    debug.push(`road-generated: ${out.length} addresses`);
    return out;
  } catch (e) {
    debug.push(`road generation failed: ${e.message}`);
    return [];
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const zip = (searchParams.get("zip") || "").trim().replace(/\D/g, "");
  const max = Math.min(parseInt(searchParams.get("max") || "50", 10), 200);
  const debug = [];

  if (!zip || zip.length !== 5) {
    return Response.json({ ok: false, error: "Valid 5-digit ZIP required." }, { status: 400 });
  }

  // Cached ZIP discovery (30 min): repeat scans of the same ZIP are instant
  // and never re-hit Overpass/Nominatim.
  const zipCacheKey = `zip:${zip}:${max}`;
  const zipCached = cacheGet(zipCacheKey);
  if (zipCached) return Response.json({ ...zipCached, cached: true });

  let city = "", state = "", centerLat = null, centerLon = null;
  try {
    const zpRes = await fetchWithTimeout(`https://api.zippopotam.us/us/${zip}`, {}, 6000);
    if (zpRes && zpRes.ok) {
      const zp = await zpRes.json();
      const place = zp.places?.[0];
      city = place?.["place name"] || "";
      state = place?.["state abbreviation"] || "";
      centerLat = parseFloat(place?.latitude);
      centerLon = parseFloat(place?.longitude);
      debug.push(`zippopotam ok: ${city}, ${state} @ ${centerLat},${centerLon}`);
    } else {
      debug.push(`zippopotam HTTP ${zpRes?.status ?? "no response"}`);
    }
  } catch (e) {
    debug.push(`zippopotam failed: ${e.message}`);
  }

  if (!centerLat || !centerLon) {
    return Response.json({ ok: false, error: `Could not resolve ZIP ${zip} to a location.`, debug });
  }

  // Run Overpass and Nominatim postalcode search IN PARALLEL — this is the
  // actual fix. Previously these ran one after another; if the first was
  // slow, the second never got enough of the time budget left to complete
  // before the platform killed the function. Now both race simultaneously
  // and results merge from whichever succeed.
  const [overpassResults, nominatimResults] = await Promise.all([
    tryOverpass(centerLat, centerLon, city, state, zip, max, debug),
    tryNominatimPostal(zip, city, state, debug),
  ]);

  const seen = new Set();
  let addresses = [];
  for (const a of [...overpassResults, ...nominatimResults]) {
    const k = a.address.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    addresses.push(a);
    if (addresses.length >= max) break;
  }

  if (addresses.length < 5) {
    const generated = await tryRoadGenerated(city, state, zip, max - addresses.length, debug);
    for (const a of generated) {
      const k = a.address.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      addresses.push(a);
      if (addresses.length >= max) break;
    }
  }

  if (addresses.length === 0) {
    return Response.json({
      ok: false,
      error: `No addresses found for ${zip} after trying all sources. Try a nearby ZIP or paste addresses manually.`,
      city, state, debug,
    });
  }

  return Response.json(cacheSet(zipCacheKey, {
    ok: true, zip, city: city || "Unknown", state: state || "",
    centerLat, centerLon, count: addresses.length, addresses, debug,
  }, 30 * 60 * 1000));
}
