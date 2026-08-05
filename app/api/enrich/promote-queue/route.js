import { supabaseServer } from "../../../../lib/supabaseServer";

// POST /api/enrich/promote-queue { limit?: number, cities?: string[], minScore?: number, targetSize?: number }
//
// Two modes:
//   - limit (default): promote up to `limit` new candidates, as before.
//   - targetSize: SELF-MAINTAINING mode. Checks how many leads are
//     currently active in the queue (pending or claimed — i.e. not yet
//     resolved one way or the other) and promotes only enough new
//     candidates to bring that count up to `targetSize`. This is what
//     makes "Top 500" a maintained population instead of a one-time batch:
//     call this after every priority-worker run and leads that got
//     gated out (recent roof permit found) or completed automatically
//     get replaced by the next-best unpromoted candidate.
//
// Deliberately NOT a "continuously running forever" worker — Vercel has no
// persistent process. This is a plain, stateless, idempotent endpoint: call
// it (manually, or via an external scheduler like cron-job.org / GitHub
// Actions hitting this URL on a timer) and it brings the queue back to
// target size. That's the achievable version of "self-maintaining" on this
// platform — state lives in the database, not in a running loop.
//
// Only 'likely_residential' is promoted: enriching a $26M apartment complex
// spends permit-API quota on something a residential roofer will never bid.
export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const minScore = body.minScore ?? 0;

  let limit;
  let targetSize = null;
  if (body.targetSize != null) {
    targetSize = Math.min(body.targetSize, 5000);
    const { count: activeCount, error: countErr } = await supabase
      .from("batch_leads")
      .select("id", { count: "exact", head: true })
      .eq("enrichment_queue", "priority")
      .in("enrichment_status", ["pending", "claimed"]);
    if (countErr) return Response.json({ ok: false, error: countErr.message }, { status: 500 });
    limit = Math.max(targetSize - (activeCount ?? 0), 0);
    if (limit === 0) {
      return Response.json({ ok: true, promoted: 0, activeBeforeTopUp: activeCount, targetSize, note: "Queue already at or above target size — no top-up needed." });
    }
  } else {
    limit = Math.min(body.limit ?? 250, 2000);
  }

  let q = supabase
    .from("batch_leads")
    .select("id, priority_score")
    .eq("property_class", "likely_residential")
    .gt("priority_score", minScore)
    .is("enrichment_queue", null)
    .order("priority_score", { ascending: false })
    .order("confidence_score", { ascending: false, nullsFirst: false }) // tiebreak: near-equal scores favor stronger evidence
    .limit(limit);

  if (Array.isArray(body.cities) && body.cities.length) q = q.in("city", body.cities);

  const { data: rows, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, promoted: 0, targetSize, note: "No eligible leads found to promote — candidate pool may be exhausted for this filter." });

  const now = new Date().toISOString();
  let promoted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    for (const r of chunk) {
      const { error: upErr } = await supabase.from("batch_leads").update({
        enrichment_queue: "priority",
        enrichment_status: "pending",
        enrichment_queued_at: now,
        score_before_enrichment: r.priority_score,
      }).eq("id", r.id);
      if (!upErr) promoted++;
    }
  }

  const { count: pending } = await supabase
    .from("batch_leads")
    .select("id", { count: "exact", head: true })
    .eq("enrichment_queue", "priority")
    .eq("enrichment_status", "pending");

  return Response.json({ ok: true, promoted, targetSize, pendingInQueue: pending ?? null });
}
