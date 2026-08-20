import { supabaseServer } from "../../../../lib/supabaseServer";
import { TC_COUNTIES, FAST_SCORE_FIELDS, scoreRow, validationPriority, buildValidationChecks } from "../../../../lib/twincities/fastCycle";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || new URL(req.url).searchParams.get("secret") === secret;
}

async function insertJobs(supabase, rows, limit = 1000) {
  const normalized = rows.map(r => ({
    ...r,
    priorityScore: Number(r.priorityScore ?? r.priority_score ?? 0),
    confidenceScore: Number(r.confidenceScore ?? r.confidence_score ?? 0),
  }));
  const selected = normalized.slice(0, limit).filter(r => r.id && r.priorityScore > 0);
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
    reason: "Twin Cities autonomous evidence-gate cycle",
    status: "queued",
  }));

  let inserted = 0;
  for (let i = 0; i < jobs.length; i += 100) {
    const chunk = jobs.slice(i, i + 100);
    const { error } = await supabase.from("twincities_validation_jobs").insert(chunk);
    if (!error) inserted += chunk.length;
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
  const challengerLimit = Math.min(Math.max(Number(body.challengerLimit) || 750, 250), 1500);

  // Active priority window? (see supabase/migrations for priority_windows —
  // self-expiring, no manual deactivation needed). If one exists, split this
  // scan batch: `weight` fraction targets properties in the window's cities,
  // the rest still runs the normal full-population rotation below, so the
  // other five counties keep moving instead of fully starving.
  let windowRows = [];
  let remainingLimit = scanLimit;
  const { data: activeWindows } = await supabase
    .from("priority_windows")
    .select("label, target_cities, weight, expires_at")
    .gt("expires_at", new Date().toISOString())
    .order("activated_at", { ascending: false })
    .limit(1);
  const activeWindow = activeWindows?.[0] || null;

  if (activeWindow?.target_cities?.length) {
    const windowLimit = Math.max(1, Math.round(scanLimit * Number(activeWindow.weight)));
    const { data: wRows, error: wErr } = await supabase
      .from("batch_leads")
      .select(FAST_SCORE_FIELDS)
      .in("county", TC_COUNTIES)
      .in("city", activeWindow.target_cities)
      .eq("sales_status", "new")
      .neq("review_status", "rejected")
      .order("id", { ascending: true })
      .limit(windowLimit);
    if (!wErr && wRows?.length) {
      windowRows = wRows;
      remainingLimit = Math.max(0, scanLimit - wRows.length);
    }
  }

  // APEX 9.6 scanned the first N rows repeatedly. That meant the remaining
  // Twin Cities population could remain permanently untouched. 9.7 rotates
  // through the full eligible population deterministically.
  const { count: eligibleCount, error: countError } = await supabase
    .from("batch_leads")
    .select("id", { count: "exact", head: true })
    .in("county", TC_COUNTIES)
    .eq("sales_status", "new")
    .neq("review_status", "rejected");
  if (countError) return Response.json({ ok: false, error: countError.message }, { status: 500 });

  const total = Number(eligibleCount || 0);
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, remainingLimit)));
  const requestedPage = body.page != null ? Number(body.page) : Math.floor(Date.now() / 300000) % pageCount;
  const page = ((requestedPage % pageCount) + pageCount) % pageCount;
  const from = page * remainingLimit;
  const to = Math.min(total - 1, from + remainingLimit - 1);

  let rows = windowRows;
  if (remainingLimit > 0) {
    const { data: restRows, error } = await supabase
      .from("batch_leads")
      .select(FAST_SCORE_FIELDS)
      .in("county", TC_COUNTIES)
      .eq("sales_status", "new")
      .neq("review_status", "rejected")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    rows = [...windowRows, ...(restRows || [])];
  }

  const scored = (rows || []).map(scoreRow).filter(r => r.entered);
  scored.sort((a, b) => b.priorityScore - a.priorityScore || b.confidenceScore - a.confidenceScore);

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

  // The global leaderboard is now explicitly queried from persisted scores.
  // It is no longer incorrectly labeled as the Top 500 of the current scan page.
  const { data: globalTop, error: topError } = await supabase
    .from("batch_leads")
    .select(FAST_SCORE_FIELDS)
    .in("county", TC_COUNTIES)
    .eq("sales_status", "new")
    .neq("review_status", "rejected")
    .order("priority_score", { ascending: false, nullsFirst: false })
    .order("confidence_score", { ascending: false, nullsFirst: false })
    .limit(500);
  if (topError) return Response.json({ ok: false, error: topError.message }, { status: 500 });

  const challengers = [...(globalTop || []), ...scored]
    .sort((a, b) => Number(b.priorityScore ?? b.priority_score ?? 0) - Number(a.priorityScore ?? a.priority_score ?? 0))
    .filter((r, i, arr) => r.id && arr.findIndex(x => String(x.id) === String(r.id)) === i)
    .slice(0, challengerLimit);

  const jobs = await insertJobs(supabase, challengers, challengerLimit);

  return Response.json({
    ok: true,
    version: "APEX9.7",
    countyScope: TC_COUNTIES,
    eligiblePopulation: total,
    scanPage: page,
    pageCount,
    scannedRange: total ? { from, to } : null,
    scanned: rows?.length || 0,
    entered: scored.length,
    scoresWritten: written,
    validationJobsCreated: jobs,
    top500: (globalTop || []).map(r => ({
      id: r.id,
      score: Number(r.priority_score ?? 0),
      confidence: Number(r.confidence_score ?? 0),
      validationStatus: r.validation_status ?? "unvalidated",
      validationScore: Number(r.validation_score ?? 0),
    })),
    cutoffScore: globalTop?.[499]?.priority_score ?? null,
    generatedAt: new Date().toISOString(),
  });
}
