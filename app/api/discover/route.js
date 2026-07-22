import { discoverByRadius, discoverByPolygon, geocodePlace } from "../../../lib/discoveryCore";
import { cacheGet, cacheSet } from "../../../lib/serverCache";

export const maxDuration = 45;

export async function POST(req) {
  const body = await req.json();
  const { mode, query, polygon } = body;
  const max = Math.min(parseInt(body.max || "60", 10), 300);

  try {
    if (mode === "polygon") {
      if (!Array.isArray(polygon) || polygon.length < 3) {
        return Response.json({ ok: false, error: "A polygon needs at least 3 points." }, { status: 400 });
      }
      const key = "poly:" + JSON.stringify(polygon).slice(0, 500) + ":" + max;
      const cached = cacheGet(key);
      if (cached) return Response.json({ ...cached, cached: true });
      const addresses = await discoverByPolygon(polygon, max);
      const out = { ok: true, mode, count: addresses.length, addresses };
      cacheSet(key, out, 15 * 60 * 1000);
      return Response.json(out);
    }

    if (mode === "city" || mode === "county") {
      if (!query || query.trim().length < 2) {
        return Response.json({ ok: false, error: "Enter a city or county name." }, { status: 400 });
      }
      const key = `place:${mode}:${query.trim().toLowerCase()}:${max}`;
      const cached = cacheGet(key);
      if (cached) return Response.json({ ...cached, cached: true });

      const place = await geocodePlace(query.trim());
      if (!place) return Response.json({ ok: false, error: `Could not locate "${query}".` });

      const addresses = await discoverByRadius(place.lat, place.lon, place.radiusM, max, place.city, place.state);
      const out = { ok: true, mode, city: place.city, state: place.state, centerLat: place.lat, centerLon: place.lon, radiusM: place.radiusM, count: addresses.length, addresses };
      cacheSet(key, out, 15 * 60 * 1000);
      return Response.json(out);
    }

    return Response.json({ ok: false, error: "mode must be 'city', 'county', or 'polygon' (use /api/zip-scan for ZIP)." }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e.message || "Discovery failed" }, { status: 200 });
  }
}
