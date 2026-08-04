import { supabaseServer } from "../../../../lib/supabaseServer";

// POST /api/enrich/promote-queue { limit?: number, cities?: string[], minScore?: number }
//
// Refills the 'priority' enrichment queue with the current top-scoring
// residential leads. Kept separate from the worker so promoting (cheap,
// instant, pure DB) and enriching (slow, costs API quota) are independently
// controllable — you can promote 500 and drain them 25 at a time.
//
// Only 'likely_residential' is promoted: enriching a $26M apartment complex
// spends permit-API quota on something a residential roofer will never bid.
export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(body.limit ?? 250, 2000);
  const minScore = body.minScore ?? 0;

  let q = supabase
    .from("batch_leads")
    .select("id, priority_score")
    .eq("property_class", "likely_residential")
    .gt("priority_score", minScore)
    .is("enrichment_queue", null)
    .order("priority_score", { ascending: false })
    .limit(limit);

  if (Array.isArray(body.cities) && body.cities.length) q = q.in("city", body.cities);

  const { data: rows, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, promoted: 0, note: "No eligible leads found to promote." });

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

  return Response.json({ ok: true, promoted, pendingInQueue: pending ?? null });
}
