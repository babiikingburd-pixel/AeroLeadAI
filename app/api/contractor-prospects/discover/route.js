// Deep-search intake for a new contractor prospect: given just a business
// name and a rough location, this geocodes the location (free, keyless —
// same Census-then-Nominatim pattern as /api/geocode), attempts a
// best-effort Nominatim business-name lookup, and then derives a REAL
// service area from properties already in the database within a radius of
// that point — rather than fabricating a city list or a "fit score" out of
// nothing. Everything this route reports is either a direct geocode result
// or a count/list pulled from batch_leads; nothing here invents an address,
// a review, a license status, or a precision the underlying data doesn't
// support.
import { supabaseAdmin, isSupabaseConfigured } from "../../../../lib/supabase";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RADIUS_MILES = 12;
const MAX_SERVICE_CITIES = 15;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Same free, keyless geocoders /api/geocode uses: US Census Bureau first
// (US-only, no key, generous limits), Nominatim as fallback.
async function geocodeLocation(text) {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(text)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const match = data?.result?.addressMatches?.[0];
      if (match) return { ok: true, lat: Number(match.coordinates.y), lon: Number(match.coordinates.x), matched: match.matchedAddress, provider: "census" };
    }
  } catch {}
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&state=Minnesota&q=${encodeURIComponent(text)}`, {
      headers: { "Accept-Language": "en", "User-Agent": "AeroLeadAI Property Intelligence (contractor-discovery)" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.length) return { ok: true, lat: Number(data[0].lat), lon: Number(data[0].lon), matched: data[0].display_name, provider: "nominatim" };
    }
  } catch {}
  return { ok: false };
}

// Best-effort: is this business itself findable as a mapped point (many
// small contractors won't be — reported honestly via `found`, never faked).
async function tryFindBusiness(businessName, locationHint) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&state=Minnesota&q=${encodeURIComponent(`${businessName} ${locationHint}`)}`, {
      headers: { "Accept-Language": "en", "User-Agent": "AeroLeadAI Property Intelligence (contractor-discovery)" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.length) return { found: true, lat: Number(data[0].lat), lon: Number(data[0].lon), matched: data[0].display_name };
    }
  } catch {}
  return { found: false };
}

export async function POST(req) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });
  }

  const { businessName, locationHint, website } = await req.json().catch(() => ({}));
  if (!businessName?.trim() || !locationHint?.trim()) {
    return Response.json({ ok: false, error: "Business name and a location (city, or full address) are required." }, { status: 400 });
  }

  // Try to find the business itself first (best effort); fall back to
  // geocoding the location hint the person typed in (e.g. "Apple Valley, MN").
  const businessMatch = await tryFindBusiness(businessName.trim(), locationHint.trim());
  const geo = businessMatch.found
    ? { ok: true, lat: businessMatch.lat, lon: businessMatch.lon, matched: businessMatch.matched, provider: "nominatim-business" }
    : await geocodeLocation(locationHint.trim());

  if (!geo.ok) {
    return Response.json({
      ok: false,
      error: "Could not locate that address or city. Try a more specific location (e.g. 'Apple Valley, MN' or a full street address).",
    }, { status: 200 });
  }

  // Derive a REAL service area: distinct cities of actual properties in the
  // database within RADIUS_MILES of the geocoded point. A loose bounding box
  // first (cheap, indexed on lat/lon) then an exact haversine filter — same
  // two-step pattern used elsewhere in this codebase for radius queries.
  const latDelta = RADIUS_MILES / 69; // ~69 miles per degree latitude
  const lonDelta = RADIUS_MILES / (69 * Math.cos((geo.lat * Math.PI) / 180));
  const { data: nearby, error: nearbyErr } = await supabaseAdmin
    .from("batch_leads")
    .select("city, lat, lon")
    .gte("lat", geo.lat - latDelta).lte("lat", geo.lat + latDelta)
    .gte("lon", geo.lon - lonDelta).lte("lon", geo.lon + lonDelta)
    .not("city", "is", null)
    .limit(3000);

  if (nearbyErr) {
    return Response.json({ ok: false, error: "Database lookup failed: " + nearbyErr.message }, { status: 500 });
  }

  const cityDistance = new Map();
  for (const row of nearby || []) {
    if (row.lat == null || row.lon == null || !row.city) continue;
    const d = haversineMiles(geo.lat, geo.lon, row.lat, row.lon);
    if (d > RADIUS_MILES) continue;
    const cur = cityDistance.get(row.city);
    if (cur == null || d < cur) cityDistance.set(row.city, d);
  }
  const serviceAreaCities = [...cityDistance.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_SERVICE_CITIES)
    .map(([city]) => city);

  if (serviceAreaCities.length === 0) {
    return Response.json({
      ok: false,
      error: `Found the location (${geo.matched}) but no properties in the database fall within ${RADIUS_MILES} miles of it — this may be outside the current six-county coverage area. Not adding a contractor with an empty, unusable service area.`,
      geocode: geo,
    }, { status: 200 });
  }

  // Honest, explainable score — NOT a fabricated precision figure. Base for
  // any successful match; bonus for the business itself being locatable
  // (vs. only its city); bonus scaled to how much real service-area data
  // backs it. Capped below 96 so it never silently outranks a
  // manually-researched, human-verified prospect score.
  let score = 55;
  if (businessMatch.found) score += 15;
  score += Math.min(20, serviceAreaCities.length * 1.5);
  score = Math.min(95, Math.round(score));

  const record = {
    business_name: businessName.trim(),
    prospect: true,
    website: website?.trim() || null,
    city: geo.matched?.split(",")[0]?.trim() || locationHint.trim(),
    state: "MN",
    service_area_cities: serviceAreaCities,
    prospect_score: score,
    pitch_status: "not_started",
    verification_notes: `Auto-discovered via contractor deep-search intake. Location: ${geo.matched} (${geo.provider}). Service area is ${serviceAreaCities.length} real cities from properties in the database within ${RADIUS_MILES} miles — not a fabricated list. Business location itself was ${businessMatch.found ? "found" : "not found"} in public map data; if not found, this is anchored to the location you entered instead.`,
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("contractor_candidates")
    .insert([record])
    .select()
    .single();

  if (insertErr) {
    return Response.json({ ok: false, error: "Saved geocode but failed to save contractor: " + insertErr.message, geocode: geo, wouldSave: record }, { status: 500 });
  }

  return Response.json({
    ok: true,
    contractor: inserted,
    geocode: geo,
    businessFound: businessMatch.found,
    serviceAreaSource: `${serviceAreaCities.length} cities with real properties within ${RADIUS_MILES} miles`,
  });
}
