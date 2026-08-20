import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export const maxDuration = 30;

// Fixed probe coordinate for the imagery check — using a stable point means
// repeat checks hit /api/imagery-agent's own Supabase cache (30-day TTL)
// instead of re-billing Nearmap/Google on every health poll.
const PROBE_LAT = 44.9537;
const PROBE_LON = -93.265;

async function checkMap() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return { status: "down", detail: "NEXT_PUBLIC_MAPBOX_TOKEN not set" };
  if (!token.startsWith("pk.")) return { status: "down", detail: "Token present but is not a public (pk.*) token" };
  try {
    const res = await fetch(`https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${token}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { status: "go", detail: "Mapbox style endpoint responded 200 — token is valid, tiles should render" };
    if (res.status === 401) return { status: "down", detail: "Mapbox rejected the token (401 unauthorized) — invalid or revoked" };
    return { status: "degraded", detail: `Mapbox returned HTTP ${res.status}` };
  } catch (e) {
    return { status: "degraded", detail: `Could not reach Mapbox: ${e.message}` };
  }
}

async function checkImagery(origin, { retry = false } = {}) {
  try {
    const res = await fetch(`${origin}/api/imagery-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: PROBE_LAT, lon: PROBE_LON, lite: true, force: retry }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    const hasImage = data?.angles && Object.values(data.angles).some((v) => typeof v === "string" && v.length > 0);
    if (hasImage) {
      return { status: "go", detail: `Provider: ${data.provider || "unknown"}${data.cached ? " (cache)" : " (live fetch)"}` };
    }
    return { status: "down", detail: data?.error || (data?.notes || []).join("; ") || "No image URL returned by any provider" };
  } catch (e) {
    return { status: "degraded", detail: `Imagery check failed: ${e.message}` };
  }
}

// crawler_config / assessor_source_candidates are external tables this repo
// doesn't own the schema for — column names beyond the table's existence
// were never confirmed, so this tries a few common timestamp columns before
// falling back to a plain row-count reachability check rather than hard
// failing on a guessed column name.
async function checkTableFreshness(supabase, table) {
  for (const col of ["last_run_at", "updated_at", "created_at"]) {
    const { data, error } = await supabase.from(table).select("*").order(col, { ascending: false }).limit(1);
    if (!error) {
      const row = data?.[0];
      const ts = row?.[col];
      const ageHours = ts ? (Date.now() - new Date(ts).getTime()) / 3600000 : null;
      return { table, ok: true, lastActivity: ts || null, ageHours: ageHours !== null ? Math.round(ageHours * 10) / 10 : null, timestampColumn: col };
    }
  }
  const { count, error: countError } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (countError) return { table, ok: false, note: countError.message };
  return { table, ok: true, count, note: "no recognized timestamp column — row-count reachability only" };
}

async function checkCrawlers(supabase) {
  if (!supabase) return { status: "down", detail: "Supabase not configured", results: [] };
  const results = await Promise.all(
    ["crawler_config", "assessor_source_candidates"].map((t) => checkTableFreshness(supabase, t))
  );
  const allOk = results.every((r) => r.ok);
  const stale = results.some((r) => r.ageHours !== null && r.ageHours > 48);
  const status = !allOk ? "down" : stale ? "degraded" : "go";
  const detail = results
    .map((r) => (r.ok ? `${r.table}: ${r.ageHours !== null ? `last activity ${r.ageHours}h ago` : r.note || `${r.count ?? "?"} rows`}` : `${r.table}: ${r.note}`))
    .join(" · ");
  return { status, detail, results };
}

function overallStatus(map, imagery, crawlers) {
  const statuses = [map.status, imagery.status, crawlers.status];
  if (statuses.every((s) => s === "go")) return "go";
  if (statuses.some((s) => s === "down")) return "down";
  return "degraded";
}

export async function GET(req) {
  const supabase = supabaseServer();
  const origin = new URL(req.url).origin;

  let map = await checkMap();
  let imagery = await checkImagery(origin);
  let crawlers = await checkCrawlers(supabase);
  let overall = overallStatus(map, imagery, crawlers);

  let recovery = null;
  if (overall !== "go" && supabase) {
    // Bounded auto-recovery: the only piece we can actually retry from here
    // is imagery (bypass cache, force a fresh fetch). Map and crawler
    // failures have no in-app restart path — map is a static env var check,
    // and the crawlers are an external system this repo doesn't control —
    // so those get surfaced, not silently "recovered."
    const attempts = [];
    if (imagery.status !== "go") {
      const retried = await checkImagery(origin, { retry: true });
      attempts.push({ target: "imagery", before: imagery.status, after: retried.status });
      imagery = retried;
    }
    overall = overallStatus(map, imagery, crawlers);

    let baseline = null;
    try {
      const { data, error } = await supabase.rpc("get_last_healthy_checkpoint");
      if (!error) baseline = data;
    } catch {
      // function may not exist under this exact name/signature — non-fatal, recovery info just won't include a baseline diff
    }
    recovery = { attempts, baseline };
  }

  let checkpoint = null;
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("record_system_checkpoint", {
        map_status: map.status,
        imagery_status: imagery.status,
        crawler_status: crawlers.status,
        details: { map, imagery, crawlers, overall, recovery },
      });
      checkpoint = error ? { ok: false, error: error.message } : { ok: true, id: data };
    } catch (e) {
      checkpoint = { ok: false, error: e.message };
    }
  }

  return Response.json({
    ok: true,
    overall,
    checkedAt: new Date().toISOString(),
    map,
    imagery,
    crawlers,
    recovery,
    checkpoint,
  });
}
