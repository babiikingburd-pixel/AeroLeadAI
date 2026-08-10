import { supabaseServer } from "../../../../lib/supabaseServer";

// IDLE-RESOURCE CYCLE
//
// storm-backfill, permit-lookup, imagery-agent, and sync-assessor-data are
// all real, working endpoints that nothing ever called on a schedule.
// autonomous-cycle (vercel.json, 30 1 * * *) only drives fast-cycle,
// validation-worker, and top500-network. sync-assessor-data has its own
// cron but sweeps an arbitrary "missing parcel_id" batch, not the priority
// pool. permit-lookup, imagery-agent, and storm-backfill had no cron entry
// at all, so they sat at zero regardless of budget. This route is the
// missing scheduled caller.
//
// Order, and why it isn't "storm first" despite storm being the cheapest
// resource: gap-router is what defines "the top-1000 pool" (property_class
// = likely_residential, ranked by priority_score) and writes those leads
// into enrichment_queue = 'priority'. Everything below targets that same
// pool, so gap-router has to run first even though storm is conceptually
// the free/run-it-first resource — storm-backfill's prioritizeQueue mode
// (see that route's comments) needs the queue to already exist.
//   1. gap-router      -> defines + enqueues the top-1000 pool.
//   2. storm-backfill  -> free bulk NOAA check, prioritizeQueue:true so the
//                          pool just queued is checked before the general
//                          unordered sweep reaches it.
//   3. priority-worker -> drains the queue: permit lookup -> gate ->
//                          imagery for survivors. This is what actually
//                          spends the permit_lookup and imagery budgets.
//   4. sync-assessor-data, scoped via leadIds to the same pool instead of
//      an arbitrary sweep.
//
// Kept as its own cron entry (not folded into autonomous-cycle) so a slow
// step here (NOAA fetch, per-address permit/imagery calls) can't push out
// the scoring/validation cycle that already runs on its own schedule.
export const maxDuration = 300;

function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const origin = new URL(req.url).origin;
  const headers = { "Content-Type": "application/json", ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) };
  const call = async (path, body) => {
    const res = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return { status: res.status, data };
  };

  const cycleStarted = new Date().toISOString();

  const gapRouting = await call("/api/enrich/gap-router", { commit: true, limit: 1000 });
  const stormBackfill = await call("/api/enrich/storm-backfill", { prioritizeQueue: true, limit: 3000 });
  const priorityWork = await call("/api/enrich/priority-worker", { limit: 25, workerId: `idle-cycle-${Date.now()}` });

  const { data: poolRows } = await supabase
    .from("batch_leads")
    .select("id")
    .eq("property_class", "likely_residential")
    .order("priority_score", { ascending: false })
    .limit(1000);
  const assessorSync = await call("/api/sync-assessor-data", {
    leadIds: (poolRows || []).slice(0, 100).map((r) => r.id),
  });

  return Response.json({
    ok: true,
    cycleStarted,
    pool: { size: poolRows?.length || 0, scope: "property_class=likely_residential, top by priority_score" },
    gapRouting,
    stormBackfill,
    priorityWork,
    assessorSync,
    cycleFinished: new Date().toISOString(),
  });
}

export async function GET(req) {
  return POST(req);
}
