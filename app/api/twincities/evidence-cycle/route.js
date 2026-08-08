import { supabaseServer } from "../../../../lib/supabaseServer";

export const maxDuration = 60;

const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 8;

function auth(req) {
  const secret = process.env.CRON_SECRET;
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

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const origin = new URL(req.url).origin;

  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select("*")
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .gt("priority_score", 0)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("priority_score", { ascending: false })
    .order("confidence_score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, processed: 0, note: "No scored candidates remain in the active pipeline." });

  const results = [];
  for (const row of rows) {
    const address = `${row.address}, ${row.city || ""}, MN`;
    const started = new Date().toISOString();

    // These are intentionally independent so a slow provider does not block
    // unrelated evidence. The existing routes persist their own evidence.
    const [permit, weather, imagery] = await Promise.all([
      fetchJson(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`, {}, 10000),
      fetchJson(`${origin}/api/weather-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: row.lat, lon: row.lon }),
      }, 10000),
      fetchJson(`${origin}/api/imagery-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: row.lat, lon: row.lon, address: row.address, leadId: row.id, lite: true, force: true }),
      }, 15000),
    ]);

    const records = permit.data?.records || [];
    const roofPermits = records.filter(p =>
      p.roof_related === true ||
      /roof|shingle|reroof|re-roof|roofing/i.test(`${p.permit_type || ""} ${p.description || ""}`)
    );

    const patch = {
      permit_evidence_status: permit.ok ? (records.length ? "verified" : "none_found") : "unknown",
      permit_checked_at: permit.ok ? started : null,
      permit_notes: JSON.stringify({
        checked_at: started,
        total_permits: records.length,
        roof_permits: roofPermits.length,
        source: permit.data?.inDirectory ? "directory" : "external_or_lookup",
      }),
      permit_history_count: records.length,
      permit_history: records,
      image_evidence_status: imagery.ok ? "fetched" : "failed",
      image_fetched_at: imagery.ok ? started : null,
      weather_evidence_status: weather.ok ? "verified" : "unknown",
      weather_checked_at: weather.ok ? started : null,
      weather_evidence: weather.ok ? weather.data : null,
      evidence_cycle_at: started,
      evidence_cycle_version: "APEX10.2",
    };

    if (weather.ok) {
      patch.freeze_thaw_signal = !!weather.data?.freezeThawSignal;
      patch.current_snow_signal = Number(weather.data?.snowPeriods || 0) > 0;
      patch.weather_summary = weather.data?.summary || null;
    }

    await supabase.from("batch_leads").update(patch).eq("id", row.id);

    // Ask the existing validation worker/evidence machinery to rescore this
    // property after the evidence has been persisted.
    const rescore = await fetchJson(`${origin}/api/twincities/validation-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) },
      body: JSON.stringify({ limit: 1, workerId: `evidence-cycle-${row.id}` }),
    }, 20000);

    results.push({
      id: row.id,
      address: row.address,
      scoreBefore: row.priority_score,
      permitsFound: records.length,
      roofPermits: roofPermits.length,
      weatherChecked: weather.ok,
      imageryFetched: imagery.ok,
      rescoreTriggered: rescore.ok,
    });
  }

  return Response.json({
    ok: true,
    version: "APEX10.2",
    processed: results.length,
    order: "priority_desc_then_confidence_desc",
    results,
    note: "Evidence cycle processes highest-ranked properties first and persists permit history, weather evidence, imagery retrieval, then triggers rescoring.",
  });
}
