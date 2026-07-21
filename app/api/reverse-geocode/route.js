// Server-side reverse geocoding (lat/lon -> street address), server-side so
// it avoids browser CORS and Nominatim's usage policy is honored with a
// consistent User-Agent from one place instead of ad-hoc client fetches.
// Nominatim is primary since it resolves to an actual street address —
// Census's coordinates endpoint doesn't do that (see lib/censusGeo.js), but
// is used here to fill in the authoritative county name, which Nominatim's
// `county` field doesn't always have.
//
// Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim)
// blocks heavy/shared-IP automated traffic outright (confirmed: this app's
// own hosting environment got a flat "Access denied" during testing, not a
// rate limit) — BigDataCloud's free keyless reverse-geocode client API is
// the fallback so this degrades to city/state/zip/county instead of failing
// outright. It doesn't resolve a precise street number, so Nominatim stays
// primary whenever it's reachable.

import { getCountyForPoint } from "../../../lib/censusGeo";

async function reverseViaNominatim(lat, lon) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
    headers: { "Accept-Language": "en", "User-Agent": "AeroLeadAI Property Intelligence (contact: set-your-email@example.com)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.address) return null;
  const addr = data.address;
  return {
    address: data.display_name || null,
    houseNumber: addr.house_number || null,
    street: addr.road || null,
    city: addr.city || addr.town || addr.village || null,
    state: addr.state || null,
    zip: addr.postcode || null,
    county: addr.county || null,
    provider: "nominatim",
  };
}

async function reverseViaBigDataCloud(lat, lon) {
  const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.city && !data?.locality) return null;
  return {
    address: null, // locality-level only, no street/house number
    houseNumber: null,
    street: null,
    city: data.city || data.locality || null,
    state: data.principalSubdivision || null,
    zip: data.postcode || null,
    county: (data.localityInfo?.administrative || []).find((a) => a.adminLevel === 6)?.name || null,
    provider: "bigdatacloud",
  };
}

export async function POST(req) {
  const { lat, lon } = await req.json();
  if (!lat || !lon) return Response.json({ ok: false, error: "lat/lon required" }, { status: 400 });

  let result = null;
  try { result = await reverseViaNominatim(lat, lon); } catch (_) { /* fall through */ }
  if (!result) {
    try { result = await reverseViaBigDataCloud(lat, lon); } catch (_) { /* fall through */ }
  }
  if (!result) {
    return Response.json({ ok: false, error: "No address match for these coordinates from any provider." });
  }

  // Fill in the authoritative county/state when the primary provider didn't have it.
  if (!result.county || !result.state) {
    const county = await getCountyForPoint(lat, lon);
    if (county) {
      result.county = result.county || county.name;
      result.state = result.state || county.state;
    }
  }

  return Response.json({ ok: true, ...result });
}
