// Server-side geocoding for batch intake. Census Bureau first (free, keyless,
// US-only, no rate pain), Nominatim as fallback. Server-side so the batch loop
// never trips CORS and never needs the user to click "Find coordinates."

import { cacheGet, cacheSet } from "../../../lib/serverCache";
import { isValidAddress } from "../../../lib/validate";

export async function POST(req) {
  const { address } = await req.json();
  if (!isValidAddress(address)) return Response.json({ ok: false, notes: "Valid address (3-300 chars) required." }, { status: 400 });
  // Dedup: identical geocode requests within 15 min return the cached hit
  // instantly and never re-hit Census/Nominatim.
  const cacheKey = "geo:" + address.trim().toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return Response.json({ ...cached, cached: true });

  // 1. US Census Bureau
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const match = data?.result?.addressMatches?.[0];
      if (match) {
        return Response.json(cacheSet(cacheKey, { ok: true, lat: String(match.coordinates.y), lon: String(match.coordinates.x), matchedAddress: match.matchedAddress, provider: "census" }));
      }
    }
  } catch (e) { /* fall through */ }

  // 2. Nominatim fallback
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`, {
      headers: { "Accept-Language": "en", "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.length) {
        return Response.json(cacheSet(cacheKey, { ok: true, lat: data[0].lat, lon: data[0].lon, matchedAddress: data[0].display_name, provider: "nominatim" }));
      }
    }
  } catch (e) { /* fall through */ }

  return Response.json({ ok: false, notes: "No geocode match from Census or Nominatim." });
}
