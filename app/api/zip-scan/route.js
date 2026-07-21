// Returns real residential addresses for a US ZIP code.
// Layered approach since no single free source is reliable alone:
//  1. Zippopotam — ZIP -> city/state/lat/lon (fast, reliable, no key)
//  2. Overpass (OSM) — real addressed buildings near centroid, 8s timeout
//  3. Nominatim postalcode search — fallback if Overpass times out/empty
//  4. Nominatim road search + generated house numbers — last resort
// debug field in the response shows which step produced results.
// Layers run sequentially (each is a fallback for the previous), so the
// worst case is the sum of every layer's timeout — raise maxDuration so a
// slow-but-not-dead upstream doesn't get killed by Vercel's default 10s.
export const maxDuration = 45;

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const zip = (searchParams.get("zip") || "").trim().replace(/\D/g, "");
  const max = Math.min(parseInt(searchParams.get("max") || "50", 10), 200);
  const debug = [];

  if (!zip || zip.length !== 5) {
    return Response.json({ ok: false, error: "Valid 5-digit ZIP required." });
  }

  let city = "", state = "", centerLat = null, centerLon = null;
  try {
    const zpRes = await fetchWithTimeout(`https://api.zippopotam.us/us/${zip}`, {}, 6000);
    if (zpRes.ok) {
      const zp = await zpRes.json();
      const place = zp.places?.[0];
      city = place?.["place name"] || "";
      state = place?.["state abbreviation"] || "";
      centerLat = parseFloat(place?.latitude);
      centerLon = parseFloat(place?.longitude);
      debug.push(`zippopotam ok: ${city}, ${state} @ ${centerLat},${centerLon}`);
    } else {
      debug.push(`zippopotam HTTP ${zpRes.status}`);
    }
  } catch (e) {
    debug.push(`zippopotam failed: ${e.message}`);
  }

  if (!centerLat || !centerLon) {
    return Response.json({ ok: false, error: `Could not resolve ZIP ${zip} to a location.`, debug });
  }

  let addresses = [];

  // Layer 2: Overpass real addressed buildings
  try {
    const query = `[out:json][timeout:15];(node["addr:housenumber"]["addr:street"](around:3000,${centerLat},${centerLon});way["addr:housenumber"]["addr:street"](around:3000,${centerLat},${centerLon}););out center ${max * 2};`;
    const opRes = await fetchWithTimeout("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    }, 9000);
    if (opRes.ok) {
      const op = await opRes.json();
      const seen = new Set();
      for (const el of op.elements || []) {
        const t = el.tags || {};
        const num = t["addr:housenumber"], street = t["addr:street"];
        if (!num || !street) continue;
        const key = `${num} ${street}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        addresses.push({ address: `${num} ${street}, ${t["addr:city"] || city}, ${state} ${zip}`, lat: lat ? String(lat) : null, lon: lon ? String(lon) : null });
        if (addresses.length >= max) break;
      }
      debug.push(`overpass: ${addresses.length} addresses`);
    } else {
      debug.push(`overpass HTTP ${opRes.status}`);
    }
  } catch (e) {
    debug.push(`overpass failed: ${e.message}`);
  }

  // Layer 3: Nominatim postalcode search
  if (addresses.length < 8) {
    try {
      const nomRes = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&addressdetails=1&limit=50`,
        { headers: { "User-Agent": "AeroLeadAI/1.0", "Accept-Language": "en" } },
        8000
      );
      if (nomRes.ok) {
        const nomData = await nomRes.json();
        const seen = new Set(addresses.map((a) => a.address.toLowerCase()));
        for (const r of nomData) {
          const a = r.address || {};
          if (!a.house_number || !a.road) continue;
          const full = `${a.house_number} ${a.road}, ${a.city || a.town || a.village || city}, ${a.state_code || state} ${zip}`;
          if (seen.has(full.toLowerCase())) continue;
          seen.add(full.toLowerCase());
          addresses.push({ address: full, lat: r.lat || null, lon: r.lon || null });
          if (addresses.length >= max) break;
        }
        debug.push(`nominatim postalcode: total now ${addresses.length}`);
      } else {
        debug.push(`nominatim postalcode HTTP ${nomRes.status}`);
      }
    } catch (e) {
      debug.push(`nominatim postalcode failed: ${e.message}`);
    }
  }

  // Layer 4: generate on real nearby road names
  if (addresses.length < 5) {
    try {
      const roadRes = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + " " + state)}&format=json&addressdetails=1&limit=25&extratags=1`,
        { headers: { "User-Agent": "AeroLeadAI/1.0" } },
        8000
      );
      let roads = [];
      if (roadRes.ok) {
        const roadData = await roadRes.json();
        roads = [...new Set(roadData.map((r) => r.address?.road).filter(Boolean))];
      }
      const nums = [104, 218, 335, 442, 556, 623, 741, 858, 902, 1015];
      const seen = new Set(addresses.map((a) => a.address.toLowerCase()));
      outer: for (const road of roads) {
        for (const n of nums.slice(0, 4)) {
          const full = `${n} ${road}, ${city}, ${state} ${zip}`;
          if (seen.has(full.toLowerCase())) continue;
          seen.add(full.toLowerCase());
          addresses.push({ address: full, lat: null, lon: null });
          if (addresses.length >= max) break outer;
        }
      }
      debug.push(`road-generated: total now ${addresses.length}`);
    } catch (e) {
      debug.push(`road generation failed: ${e.message}`);
    }
  }

  addresses = addresses.slice(0, max);

  if (addresses.length === 0) {
    return Response.json({
      ok: false,
      error: `No addresses found for ${zip} after trying all sources. Try a nearby ZIP or paste addresses manually.`,
      city, state, debug,
    });
  }

  return Response.json({
    ok: true, zip, city: city || "Unknown", state: state || "",
    centerLat, centerLon, count: addresses.length, addresses, debug,
  });
}
