import { supabaseServer } from "../../../../lib/supabaseServer";
import { TC_COUNTIES, FAST_SCORE_FIELDS, scoreRow, validationPriority, buildValidationChecks } from "../../../../lib/twincities/fastCycle";

export const maxDuration = 60;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

async function insertJobs(supabase, rows, limit = 750) {
  const selected = rows.slice(0, limit).filter(r => r.entered && r.priorityScore > 0);
  if (!selected.length) return 0;
  const ids = selected.map(r => r.id);
  const { data: active, error: activeErr } = await supabase
    .from("twincities_validation_jobs")
    .select("property_id")
    .in("property_id", ids)
    .in("status", ["queued", "claimed", "running"]);
  if (activeErr) throw new Error(activeErr.message);
  const activeIds = new Set((active || []).map(x => String(x.property_id)));
  const jobs = selected.filter(r => !activeIds.has(String(r.id))).map(r => ({
    property_id: String(r.id),
    priority: validationPriority(r),
    requested_checks: buildValidationChecks(r),
    reason: "Twin Cities fast-cycle validation",
    status: "queued",
  }));
  let inserted = 0;
  for (let i = 0; i < jobs.length; i += 100) {
    const { error } = await supabase.from("twincities_validation_jobs").insert(jobs.slice(i, i + 100));
    if (!error) inserted += Math.min(100, jobs.length - i);
  }
  return inserted;
}

export async function POST(req) {
  if (!authorized(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const scanLimit = Math.min(Math.max(Number(body.scanLimit) || 1000, 100), 2000);
  const challengerLimit = Math.min(Math.max(Number(body.challengerLimit) || 750, 250), 1000);

  const { data: rows, error } = await supabase
    .from("batch_leads")
    .select(FAST_SCORE_FIELDS)
    .in("county", TC_COUNTIES)
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .limit(scanLimit);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const scored = (rows || []).map(scoreRow).filter(r => r.entered);
  scored.sort((a, b) => b.priorityScore - a.priorityScore || b.confidenceScore - a.confidenceScore);

  // Only persist score state. The dashboard reads this state; it no longer
  // recalculates and writes hundreds of rows on every GET request.
  let written = 0;
  for (let i = 0; i < scored.length; i += 50) {
    const chunk = scored.slice(i, i + 50);
    const results = await Promise.all(chunk.map(r => supabase.from("batch_leads").update({
      evidence_score: r.evidenceScore,
      evidence_categories: r.categories,
      evidence_breakdown: r.breakdown,
      confidence_score: r.confidenceScore,
      priority_score: r.priorityScore,
      human_review: r.humanReview,
      tier: r.tier,
      scored_at: new Date().toISOString(),
      validation_priority: validationPriority(r),
    }).eq("id", r.id)));
    written += results.filter(x => !x.error).length;
  }

  const jobs = await insertJobs(supabase, scored, challengerLimit);
  return Response.json({
    ok: true,
    countyScope: TC_COUNTIES,
    scanned: rows?.length || 0,
    entered: scored.length,
    scoresWritten: written,
    validationJobsCreated: jobs,
    top500: scored.slice(0, 500).map(r => ({ id: r.id, score: r.priorityScore, confidence: r.confidenceScore })),
    cutoffScore: scored[499]?.priorityScore ?? null,
    challengerFloor: scored[Math.min(scored.length - 1, 749)]?.priorityScore ?? null,
    generatedAt: new Date().toISOString(),
  });
}
