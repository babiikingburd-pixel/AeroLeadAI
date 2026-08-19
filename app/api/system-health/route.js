import { activeProvider } from "../../../lib/aiClient";
import { supabaseServer } from "../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 12;

async function pingUrl(url, ms = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, method: "GET", cache: "no-store" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}

async function timed(name, fn, timeoutMs = 6000) {
  const started = Date.now();
  return Promise.race([
    Promise.resolve().then(fn)
      .then(value => ({ name, ok: true, ms: Date.now() - started, value }))
      .catch(error => ({ name, ok: false, ms: Date.now() - started, error: error?.message || String(error) })),
    new Promise(resolve => setTimeout(() => resolve({ name, ok: false, ms: Date.now() - started, error: `timeout after ${timeoutMs}ms` }), timeoutMs)),
  ]);
}

export async function GET() {
  const db = supabaseServer();
  const aiProvider = activeProvider();
  const imageryProvider = process.env.EAGLEVIEW_CLIENT_ID || process.env.EAGLEVIEW_API_KEY
    ? "eagleview"
    : process.env.NEARMAP_API_KEY
      ? "nearmap"
      : process.env.GOOGLE_MAPS_API_KEY
        ? "google"
        : process.env.MAPBOX_TOKEN
          ? "mapbox"
          : "esri-free";

  const [properties, contractors, top100, jobs, overpassUp, nominatimUp, nwsUp] = await Promise.all([
    timed("supabase_properties", async () => {
      if (!db) throw new Error("Supabase not configured");
      const { data, error } = await db.from("batch_leads")
        .select("id,priority_score,confidence_score")
        .eq("sales_status", "new")
        .order("priority_score", { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw error;
      return { reachable: true, sampleAvailable: !!data?.[0] };
    }),
    timed("contractor_network", async () => {
      if (!db) throw new Error("Supabase not configured");
      const { data, error, count } = await db.from("contractor_candidates")
        .select("id,business_name,service_area_cities,prospect_score", { count: "exact" })
        .eq("prospect", true)
        .order("prospect_score", { ascending: false })
        .limit(3);
      if (error) throw error;
      return { contractors: count ?? null, sample: data || [] };
    }),
    timed("top100", async () => {
      if (!db) throw new Error("Supabase not configured");
      const { data, error } = await db.from("batch_leads")
        .select("id,address,city,priority_score,confidence_score,image_evidence_status")
        .eq("sales_status", "new")
        .neq("review_status", "rejected")
        .gt("priority_score", 0)
        .order("priority_score", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = data || [];
      return {
        visible: rows.length,
        confidence70Plus: rows.filter(r => Number(r.confidence_score || 0) >= 70).length,
        imageryMarked: rows.filter(r => ["fetched", "verified", "ready"].includes(String(r.image_evidence_status || "").toLowerCase())).length,
      };
    }),
    timed("validation_queue", async () => {
      if (!db) throw new Error("Supabase not configured");
      const { data, error } = await db.from("twincities_validation_jobs")
        .select("id,status,priority,reason")
        .in("status", ["queued", "running"])
        .order("priority", { ascending: false })
        .limit(50);
      if (error) throw error;
      return { activeJobs: data?.length || 0 };
    }),
    pingUrl("https://overpass-api.de/api/interpreter?data=[out:json];out;"),
    pingUrl("https://nominatim.openstreetmap.org/status.php"),
    pingUrl("https://api.weather.gov/"),
  ]);

  const dataChecks = [properties, contractors, top100, jobs];
  const readPathOk = properties.ok && contractors.ok && top100.ok;
  const workerReadOk = jobs.ok;
  const external = { overpass: overpassUp, nominatim: nominatimUp, nws: nwsUp };
  const mode = readPathOk ? (workerReadOk ? "OPERATIONAL_READ_PATH" : "READ_PATH_OK_WORKER_DEGRADED") : "DEGRADED";

  return Response.json({
    ok: readPathOk,
    healthy: readPathOk && workerReadOk,
    mode,
    checkedAt: new Date().toISOString(),
    configured: { aiProvider: aiProvider || null, imageryProvider, supabase: !!db, cronSecret: !!process.env.CRON_SECRET },
    dataChecks,
    external,
    standards: {
      fakeDataAllowed: false,
      silentFailuresAllowed: false,
      cachedDataMustBeLabeled: true,
      queuedActionsMustBeLabeled: true,
      confidenceMustComeFromEvidence: true,
    },
  }, { headers: { "cache-control": "no-store" } });
}
