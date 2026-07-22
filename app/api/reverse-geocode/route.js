// GPS coordinates -> street address, server-side (no CORS pain, cached).
// Census Bureau reverse geocoder first (free, keyless, US), Nominatim fallback.
import { cacheGet, cacheSet } from "../../../lib/serverCache";
import { isValidLatLon } from "../../../lib/validate";

export async function POST(req) {
  const { lat, lon } = await req.json();
  if (!isValidLatLon(lat, lon)) {
    return Response.json({ ok: false, error: "Valid lat/lon required." }, { status: 400 });
  }
  const key = `rev:${parseFloat(lat).toFixed(5)},${parseFloat(lon).toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached) return Response.json({ ...cached, cached: true });

  // 1. US Census reverse geocode
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const zip = data?.result?.geographies?.["2020 Census Blocks"]?.[0]?.ZCTA5 || null;
      // Census reverse gives geography, not a street line — Nominatim below
      // supplies the street; keep zip as fallback.
      if (zip) cacheSet(key + ":zip", zip);
    }
  } catch { /* fall through */ }

  // 2. Nominatim reverse (street-level address line)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { "User-Agent": "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app)", "Accept-Language": "en" } }
    );
    if (res.ok) {
      const d = await res.json();
      const a = d.address || {};
      const line = [a.house_number, a.road].filter(Boolean).join(" ");
      const city = a.city || a.town || a.village || "";
      const state = a.state || "";
      const zip = a.postcode || cacheGet(key + ":zip") || "";
      const address = [line, city, state, zip].filter(Boolean).join(", ");
      const out = { ok: true, address: address || d.display_name, zip, provider: "nominatim" };
      cacheSet(key, out);
      return Response.json(out);
    }
  } catch { /* fall through */ }

  const zipOnly = cacheGet(key + ":zip");
  if (zipOnly) {
    const out = { ok: true, address: "", zip: zipOnly, provider: "census-zip-fallback" };
    return Response.json(out);
  }
  return Response.json({ ok: false, error: "Reverse geocode failed — enter a ZIP code instead." });
}
