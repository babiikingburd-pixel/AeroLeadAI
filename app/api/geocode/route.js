// Server-side geocoding for batch intake. Census Bureau first (free, keyless,
// US-only), Nominatim as fallback. Server-side so the batch loop never trips
// CORS and never needs a manual "Find coordinates" click.

const STATE_PATTERN = /\b[A-Z]{2}\b/; // crude but effective check for a state code
const DEFAULT_STATE = "MN"; // AeroLeadAI's documented service territory (Scott County / Twin Cities)

async function censusLookup(address) {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const match = data?.result?.addressMatches?.[0];
      if (match) return { ok: true, lat: String(match.coordinates.y), lon: String(match.coordinates.x), matchedAddress: match.matchedAddress, provider: "census" };
    }
  } catch (e) { /* fall through */ }
  return null;
}

async function nominatimLookup(address) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`, {
      headers: { "Accept-Language": "en", "User-Agent": "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app; contact: ops@aeroleadai.com)" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.length) return { ok: true, lat: data[0].lat, lon: data[0].lon, matchedAddress: data[0].display_name, provider: "nominatim" };
    }
  } catch (e) { /* fall through */ }
  return null;
}

export async function POST(req) {
  const { address } = await req.json();
  if (!address) return Response.json({ ok: false, notes: "No address provided." });

  const result = (await censusLookup(address)) || (await nominatimLookup(address));
  if (result) return Response.json(result);

  // Both failed on the address as typed. If it has no state code (the classic
  // "123 Main St" with no city/state at all), retry once against the
  // documented service territory before giving up — this is a real fallback
  // grounded in AeroLeadAI's actual coverage area, not a blind guess.
  if (!STATE_PATTERN.test(address)) {
    const retryAddress = `${address}, ${DEFAULT_STATE}`;
    const retryResult = (await censusLookup(retryAddress)) || (await nominatimLookup(retryAddress));
    if (retryResult) {
      return Response.json({ ...retryResult, assumedState: DEFAULT_STATE, notes: `No city/state in the address you entered — matched by assuming "${DEFAULT_STATE}" (your service territory). Add the full city/state to avoid this guess.` });
    }
  }

  return Response.json({
    ok: false,
    notes: STATE_PATTERN.test(address)
      ? `No geocode match for "${address}" from Census or Nominatim — double-check the street spelling and city.`
      : `"${address}" is missing a city and state, and even assuming ${DEFAULT_STATE} didn't resolve it. Use the full format: "Street, City, ST ZIP".`,
  });
}
