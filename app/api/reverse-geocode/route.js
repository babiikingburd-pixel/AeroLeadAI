// Reverse geocoding: lat/lon -> street address. Server-side to avoid CORS
// and to keep a consistent User-Agent (Nominatim throttles/blocks requests
// without proper contact info in the UA — same class of bug that broke
// zip-scan, fixed the same way here from the start).

export async function POST(req) {
  const { lat, lon } = await req.json();
  if (!lat || !lon) return Response.json({ ok: false, error: "lat/lon required" }, { status: 400 });

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { "User-Agent": "AeroLeadAI-PropertyIntel/1.0 (+https://aero-lead-ai.vercel.app; contact: ops@aeroleadai.com)", "Accept-Language": "en" } }
    );
    if (!res.ok) return Response.json({ ok: false, error: `Reverse geocode HTTP ${res.status}` });
    const data = await res.json();
    if (!data || data.error) return Response.json({ ok: false, error: "No address found at this location." });

    const a = data.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.suburb || "";
    const state = a.state_code || a.state || "";
    const zip = a.postcode || "";
    const formatted = [street, city, state, zip].filter(Boolean).join(", ");

    return Response.json({
      ok: true,
      address: formatted || data.display_name,
      displayName: data.display_name,
      lat: String(lat), lon: String(lon),
      raw: a,
    });
  } catch (e) {
    return Response.json({ ok: false, error: "Reverse geocode failed: " + e.message });
  }
}
