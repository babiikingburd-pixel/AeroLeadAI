import { activeProvider } from "../../../lib/aiClient";

// Self-diagnostic for the Operations Command Center: which subsystems are
// actually configured and reachable, right now. Reports booleans/status
// only — never leaks key values. This is real signal (env presence +
// a live upstream ping), not a simulated uptime percentage.
async function pingUrl(url, ms = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}

export async function GET() {
  const aiProvider = activeProvider();
  const hasSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const imageryProvider = process.env.NEARMAP_API_KEY ? "nearmap" : process.env.GOOGLE_MAPS_API_KEY ? "google" : process.env.MAPBOX_TOKEN ? "mapbox" : "esri-free";

  const [overpassUp, nominatimUp, nwsUp] = await Promise.all([
    pingUrl("https://overpass-api.de/api/interpreter?data=[out:json];out;"),
    pingUrl("https://nominatim.openstreetmap.org/status.php"),
    pingUrl("https://api.weather.gov/"),
  ]);

  const checks = [
    { name: "AI provider (damage/lead scoring)", ok: !!aiProvider, detail: aiProvider || "none configured — set GROQ_API_KEY or ANTHROPIC_API_KEY" },
    { name: "Imagery provider", ok: true, detail: imageryProvider },
    { name: "Supabase (durable storage, jobs, contractors, portal)", ok: hasSupabase, detail: hasSupabase ? "configured" : "not configured — falls back to localStorage where possible; jobs/contractors need it" },
    { name: "Discovery sources (Overpass)", ok: overpassUp, detail: overpassUp ? "reachable" : "unreachable right now" },
    { name: "Geocoding (Nominatim)", ok: nominatimUp, detail: nominatimUp ? "reachable" : "unreachable right now" },
    { name: "Weather (NWS)", ok: nwsUp, detail: nwsUp ? "reachable" : "unreachable right now" },
    { name: "Rate limiting", ok: true, detail: `${process.env.RATE_LIMIT_PER_MIN || 60}/min default (middleware.js)` },
  ];

  return Response.json({ ok: true, checkedAt: new Date().toISOString(), healthy: checks.every((c) => c.ok), checks });
}
