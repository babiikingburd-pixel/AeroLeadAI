import { activeProvider } from "../../../lib/aiClient";
import { supabaseServer } from "../../../lib/supabaseServer";
import { costStatus } from "../../../lib/twincities/costGuard";

// Every environment variable the app reads, declared once. `oneOf` means the
// group is satisfied by any member — that is how the Supabase key chain works,
// and hardcoding a shorter chain here is exactly how this endpoint used to
// report a healthy deployment as broken.
//
// required: the app cannot do its job without it.
// optional: a real capability is unavailable without it, and callers deserve
//           to be told which one rather than discovering it at request time.
const ENV_MATRIX = [
  { name: "Supabase URL", required: true,
    oneOf: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"] },
  { name: "Supabase key", required: true,
    oneOf: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ANON_KEY",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_PUBLISHABLE_KEY"] },
  { name: "AI provider", required: true, capability: "damage + lead scoring",
    oneOf: ["ANTHROPIC_API_KEY", "GROQ_API_KEY"] },
  { name: "Imagery provider", required: false, capability: "high-resolution roof imagery",
    oneOf: ["NEARMAP_API_KEY", "GOOGLE_MAPS_API_KEY", "MAPBOX_TOKEN"],
    fallback: "esri-free" },
  { name: "Permit API", required: false, capability: "permit evidence (billed per lookup)",
    oneOf: ["PERMIT_API_KEY"] },
  { name: "Cron secret", required: false, capability: "worker endpoint authentication",
    oneOf: ["CRON_SECRET"],
    warnWhenMissing: "worker endpoints accept unauthenticated POSTs without this" },
];

function evaluateEnv() {
  return ENV_MATRIX.map((entry) => {
    const present = entry.oneOf.filter((key) => !!process.env[key]);
    const ok = present.length > 0 || !entry.required;
    return {
      name: entry.name,
      required: entry.required,
      satisfied: present.length > 0,
      ok,
      // Names only. This endpoint never reports a value.
      using: present[0] ?? null,
      alsoSet: present.slice(1),
      accepts: entry.oneOf,
      capability: entry.capability ?? null,
      detail: present.length
        ? `set via ${present[0]}${present.length > 1 ? ` (+${present.length - 1} more)` : ""}`
        : entry.fallback
          ? `not set — falling back to ${entry.fallback}`
          : entry.warnWhenMissing
            ? `not set — ${entry.warnWhenMissing}`
            : `not set — accepts any of: ${entry.oneOf.join(", ")}`,
    };
  });
}

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
  const env = evaluateEnv();
  const envOk = env.every((e) => e.ok);
  // Must mirror supabaseServer()'s resolution order exactly, or this reports
  // "not configured" on a deployment the rest of the app connects from
  // perfectly well — SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_ANON_KEY
  // were all missing from this check.
  const hasSupabase = !!(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY)
  );
  const imageryProvider = process.env.NEARMAP_API_KEY ? "nearmap" : process.env.GOOGLE_MAPS_API_KEY ? "google" : process.env.MAPBOX_TOKEN ? "mapbox" : "esri-free";

  const [overpassUp, nominatimUp, nwsUp] = await Promise.all([
    pingUrl("https://overpass-api.de/api/interpreter?data=[out:json];out;"),
    pingUrl("https://nominatim.openstreetmap.org/status.php"),
    pingUrl("https://api.weather.gov/"),
  ]);

  // Cost guard state. A tripped kill switch is a health problem: every paid
  // worker is refusing work until somebody clears it.
  let cost = null;
  try {
    const supabase = supabaseServer();
    if (supabase) cost = await costStatus(supabase);
  } catch (e) {
    cost = { error: e.message };
  }

  const checks = [
    { name: "AI provider (damage/lead scoring)", ok: !!aiProvider, detail: aiProvider || "none configured — set GROQ_API_KEY or ANTHROPIC_API_KEY" },
    { name: "Imagery provider", ok: true, detail: imageryProvider },
    { name: "Supabase (durable storage, jobs, contractors, portal)", ok: hasSupabase, detail: hasSupabase ? "configured" : "not configured — falls back to localStorage where possible; jobs/contractors need it" },
    { name: "Discovery sources (Overpass)", ok: overpassUp, detail: overpassUp ? "reachable" : "unreachable right now" },
    { name: "Geocoding (Nominatim)", ok: nominatimUp, detail: nominatimUp ? "reachable" : "unreachable right now" },
    { name: "Weather (NWS)", ok: nwsUp, detail: nwsUp ? "reachable" : "unreachable right now" },
    { name: "Rate limiting", ok: true, detail: `${process.env.RATE_LIMIT_PER_MIN || 60}/min default (middleware.js)` },
    { name: "Environment variables", ok: envOk,
      detail: envOk
        ? `${env.filter((e) => e.satisfied).length}/${env.length} groups satisfied`
        : `missing: ${env.filter((e) => !e.ok).map((e) => e.name).join(", ")}` },
    { name: "Paid-lookup cost guard", ok: cost ? cost.paidLookupsEnabled !== false : true,
      detail: !cost ? "not evaluated (Supabase unavailable)"
        : cost.error ? `ledger error: ${cost.error}`
        : cost.paidLookupsEnabled === false
          ? `TRIPPED ${cost.disabledAt ?? ""} — ${cost.disabledReason ?? "reason not recorded"}`
          : Object.entries(cost.providers)
              .map(([p, v]) => v.error ? `${p}: ${v.error}` : `${p} ${v.used}/${v.cap}`)
              .join(", ") },
  ];

  return Response.json({
    ok: true,
    version: "APEX10.1",
    checkedAt: new Date().toISOString(),
    healthy: checks.every((c) => c.ok),
    checks,
    env,
    cost,
  });
}
