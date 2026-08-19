import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 8;
const TOP_POOL = 600;
const BAND_PLAN = [
  { start: 1, end: 25, slots: 4 },
  { start: 26, end: 100, slots: 3 },
  { start: 101, end: 500, slots: 3 },
  { start: 501, end: 600, slots: 2 },
];

function auth(req) {
  const secret = process.env.CRON_SECRET;
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  if (host && origin && origin.includes(host)) return true;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` ||
    new URL(req.url).searchParams.get("secret") === secret;
}

async function fetchJson(url, options = {}, timeout = 12000) {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

function lastTouched(row) {
  const values = [row.evidence_cycle_at, row.top500_last_investigated_at, row.weather_checked_at, row.permit_checked_at]
    .map(v => v ? Date.parse(v) : 0)
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function selectSwarm(rankedRows, limit) {
  const rows = rankedRows.map((row, i) => ({ ...row, __rank: i + 1, __lastTouched: lastTouched(row) }));
  const selected = [];
  const used = new Set();

  const add = (row) => {
    if (!row || used.has(String(row.id)) || selected.length >= limit) return;
    used.add(String(row.id));
    selected.push(row);
  };

  // The #1 lead gets a dedicated lane while confidence is still weak. We do
  // not manufacture confidence: this only forces more real evidence attempts.
  const numberOne = rows[0];
  if (numberOne && Number(numberOne.confidence_score || 0) < 85) add(numberOne);

  for (const band of BAND_PLAN) {
    if (selected.length >= limit) break;
    let slots = Math.min(band.slots, limit - selected.length);
    const pool = rows
      .filter(r => r.__rank >= band.start && r.__rank <= band.end && !used.has(String(r.id)))
      .sort((a, b) => (a.__lastTouched - b.__lastTouched) || (a.__rank - b.__rank));
    for (const row of pool) {
      if (slots <= 0 || selected.length >= limit) break;
      add(row);
      slots -= 1;
    }
  }

  // If a band is short, backfill with the stalest remaining properties from
  // the entire Top 600. This keeps ranks 2-600 alive instead of starving them.
  const leftovers = rows
    .filter(r => !used.has(String(r.id)))
    .sort((a, b) => (a.__lastTouched - b.__lastTouched) || (a.__rank - b.__rank));
  for (const row of leftovers) add(row);

  // Actual provider calls execute in numerical rank order for predictable work.
  return selected.sort((a, b) => a.__rank - b.__rank).slice(0, limit);
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const origin = new URL(req.url).origin;

  const { data: ranked, error } = await supabase
    .from("batch_leads")
    .select("*")
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .gt("priority_score", 0)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("priority_score", { ascending: false })
    .order("confidence_score", { ascending: false, nullsFirst: false })
    .limit(TOP_POOL);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!ranked?.length) return Response.json({ ok: true, processed: 0, note: "No scored candidates remain in the active pipeline." });

  const rows = selectSwarm(ranked, limit);
  const results = [];

  for (const row of rows) {
    const address = `${row.address}, ${row.city || ""}, MN`;
    const started = new Date().toISOString();

    // Independent evidence lanes: permits, storm/weather and imagery all fire
    // together. Top-500 network lanes continue doing damage/residential/
    // competition work in parallel with this confidence swarm.
    const [permit, weather, imagery] = await Promise.all([
      fetchJson(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`, {}, 10000),
      fetchJson(`${origin}/api/weather-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: row.lat, lon: row.lon, address }),
      }, 10000),
      fetchJson(`${origin}/api/imagery-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: row.lat, lon: row.lon, address: row.address, leadId: row.id, lite: true, force: true }),
      }, 15000),
    ]);

    const records = Array.isArray(permit.data?.records) ? permit.data.records : [];
    const roofPermits = records.filter(p =>
      p.roof_related === true ||
      /roof|shingle|reroof|re-roof|roofing/i.test(`${p.permit_type || ""} ${p.description || ""}`)
    );

    const patch = {
      permit_evidence_status: permit.ok ? (records.length ? "verified" : "none_found") : "unknown",
      permitChecked: permit.ok,
      permit_checked_at: permit.ok ? started : row.permit_checked_at || null,
      permit_notes: JSON.stringify({
        checked_at: started,
        total_permits: records.length,
        roof_permits: roofPermits.length,
        source: permit.data?.inDirectory ? "directory" : "external_or_lookup",
        swarm_rank: row.__rank,
      }),
      permit_history_count: records.length,
      permit_history: records,
      image_evidence_status: imagery.ok ? "fetched" : "failed",
      image_fetched_at: imagery.ok ? started : row.image_fetched_at || null,
      weather_evidence_status: weather.ok ? "verified" : "unknown",
      weather_checked_at: weather.ok ? started : row.weather_checked_at || null,
      weather_evidence: weather.ok ? weather.data : row.weather_evidence || null,
      evidence_cycle_at: started,
      evidence_cycle_version: "APEX14.2-TOP600-SWARM",
      top500_last_investigated_at: row.__rank <= 500 ? started : row.top500_last_investigated_at || null,
    };

    if (weather.ok) {
      patch.freeze_thaw_signal = !!weather.data?.freezeThawSignal;
      patch.current_snow_signal = Number(weather.data?.snowPeriods || 0) > 0;
      patch.weather_summary = weather.data?.summary || null;
    }

    await supabase.from("batch_leads").update(patch).eq("id", row.id);

    const rescore = await fetchJson(`${origin}/api/twincities/validation-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) },
      body: JSON.stringify({ limit: 1, workerId: `confidence-swarm-r${row.__rank}-${row.id}` }),
    }, 20000);

    results.push({
      id: row.id,
      rank: row.__rank,
      address: row.address,
      scoreBefore: row.priority_score,
      confidenceBefore: row.confidence_score,
      permitsFound: records.length,
      roofPermits: roofPermits.length,
      weatherChecked: weather.ok,
      imageryFetched: imagery.ok,
      rescoreTriggered: rescore.ok,
    });
  }

  return Response.json({
    ok: true,
    version: "APEX14.2-TOP600-SWARM",
    processed: results.length,
    poolSize: ranked.length,
    order: "weighted_rank_bands_then_numerical_execution",
    bands: BAND_PLAN,
    results,
    note: "Top 1 gets an aggressive low-confidence lane; ranks 2-600 are continuously rotated by staleness across four rank bands. Confidence only changes from persisted real evidence and rescoring.",
  });
}
