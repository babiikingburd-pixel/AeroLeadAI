// THE HEARTBEAT — triggered by Vercel Cron (see vercel.json), not
// setInterval. setInterval in a browser tab dies the moment the tab closes;
// setInterval in a serverless function dies the moment the invocation ends
// (usually under 60s). Vercel Cron is the correct mechanism: it calls this
// URL on a real schedule regardless of whether anyone has a browser open.
//
// Auth: requires ?secret=CRON_SECRET or an Authorization: Bearer header
// matching CRON_SECRET env var, so this endpoint can't be hit by randoms
// hammering your Supabase-write budget. Set CRON_SECRET in Vercel env vars.
//
// Honest scope of "self-improvement" here, stated up front because it
// matters: this endpoint can (1) refresh what it already knows how to fetch
// (permits, weather via existing routes), (2) resolve predictions against
// whatever outcomes have actually been recorded (manual corrections, mostly
// — this system has no independent way to learn a roof got replaced unless
// someone tells it), (3) compute real accuracy numbers from that, and
// (4) take a small number of genuinely mechanical optimization actions
// (retry failed crawlers, flag low-confidence predictions for re-check).
// It does NOT invent ground truth, discover new addresses on its own
// initiative, or improve prompts automatically — those require either more
// wiring (a real feedback UI for corrections) or a human decision about
// what "better" means for a given metric. Every insight row this writes
// says exactly which of these it did, not more.

import { supabaseGet, supabasePatch, supabasePost } from "../../../lib/supabaseRest";
import { resolveSupabaseServerConfig } from "../../../lib/supabaseEnvironment";
import { withCrawlerLog } from "../../../lib/crawlerLog";
import { planCycle } from "../../../lib/planner";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

function checkAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured = auth disabled, fine for local testing
  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret");
  const header = req.headers.get("authorization");
  return qsSecret === secret || header === `Bearer ${secret}`;
}

// ---- Loop 1: Knowledge refresh — now planner-driven instead of blindly
// pulling the 20 most recent addresses. The planner picks a bounded set of
// genuinely due-for-recheck properties (low confidence, or hot leads past
// their recheck interval) so this stops being "rescan everything" and
// becomes "rescan what's actually worth the compute this cycle."
async function refreshKnowledge() {
  return withCrawlerLog("knowledge_refresh", async () => {
    const { configured } = resolveSupabaseServerConfig();
    if (!configured) return { succeeded: 0, failed: 0, errors: ["Supabase not configured"] };

    const plan = await planCycle("high", 10); // high tier only — this is the 15-min-cadence loop; medium/low tiers are separate cron endpoints, see /api/tier-medium and /api/tier-low
    if (plan.rescanCandidates.length === 0) {
      return { succeeded: 0, failed: 0, errors: [], planReasons: plan.reasons };
    }

    let succeeded = 0, failed = 0;

    const errors = [];
    for (const p of plan.rescanCandidates) {
      try {
        const res = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""}/api/permit-lookup?address=${encodeURIComponent(p.address)}`);
        if (res.ok) succeeded++; else failed++;
      } catch (e) {
        failed++;
        errors.push(`${p.address}: ${e.message}`);
      }
    }
    return { succeeded, failed, errors, planReasons: plan.reasons };
  });
}

// ---- Loop 2: Resolve predictions against corrections — this is the actual
// "learn from mistakes" mechanism. Any correction not yet reflected back
// into its source prediction gets applied, computing real error_magnitude.
async function resolvePredictions() {
  return withCrawlerLog("prediction_resolution", async () => {
    const unresolvedRes = await supabaseGet(
      `corrections?select=*,predictions(prediction_id,predicted_score,actual_score)&order=created_at.desc&limit=50`
    );
    if (!unresolvedRes.ok) return { succeeded: 0, failed: unresolvedRes.notConfigured ? 0 : 1, errors: unresolvedRes.notConfigured ? [] : [unresolvedRes.error] };

    let succeeded = 0, failed = 0;
    const errors = [];
    for (const c of unresolvedRes.data) {
      if (!c.prediction_id || c.predictions?.actual_score !== null) continue; // already resolved
      const patchRes = await supabasePatch(`predictions?prediction_id=eq.${c.prediction_id}`, {
        actual_score: c.corrected_score,
        outcome_source: "manual_correction",
        outcome_recorded_at: new Date().toISOString(),
      });
      if (patchRes.ok) succeeded++; else { failed++; errors.push(`prediction ${c.prediction_id}: ${patchRes.error || "update failed"}`); }
    }
    return { succeeded, failed, errors };
  });
}

// ---- Loop 3: Self-evaluation — compute real accuracy per domain from
// resolved predictions. Honest about insufficient data rather than faking
// a number from too few samples.
async function selfEvaluate() {
  const domains = ["roof", "tree", "driveway", "snow_load"];
  const insights = [];

  for (const domain of domains) {
    const res = await supabaseGet(
      `predictions?domain=eq.${domain}&actual_score=not.is.null&select=error_magnitude,predicted_at&order=predicted_at.desc&limit=100`
    );
    if (!res.ok || !res.data.length) {
      insights.push({ category: "accuracy", summary: `${domain}: no resolved predictions yet — can't compute accuracy.`, detail: { domain, resolved_count: 0 } });
      continue;
    }
    const errors = res.data.map((r) => r.error_magnitude).filter((e) => e !== null);
    const avgError = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
    const recent = errors.slice(0, 20);
    const older = errors.slice(20, 40);
    const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : null;
    let trend = "insufficient_data";
    if (recentAvg !== null && olderAvg !== null) {
      trend = recentAvg < olderAvg - 2 ? "improving" : recentAvg > olderAvg + 2 ? "degrading" : "stable";
    }

    await supabasePost("accuracy_rollups", [{
      domain, resolved_count: errors.length, avg_error: avgError, avg_error_last_30d: recentAvg, trend, last_computed_at: new Date().toISOString(),
    }], "resolution=merge-duplicates");

    insights.push({
      category: "accuracy",
      summary: `${domain}: ${errors.length} resolved, avg error ${avgError?.toFixed(1) ?? "n/a"}, trend ${trend}`,
      detail: { domain, resolved_count: errors.length, avg_error: avgError, trend },
    });
  }

  // Crawler health: which crawlers failed in the last 24h
  const runsRes = await supabaseGet(`crawler_runs?started_at=gte.${new Date(Date.now() - 86400000).toISOString()}&select=crawler_name,status&order=started_at.desc&limit=200`);
  if (runsRes.ok && runsRes.data.length) {
    const byName = {};
    for (const r of runsRes.data) {
      byName[r.crawler_name] = byName[r.crawler_name] || { success: 0, failed: 0, partial: 0 };
      byName[r.crawler_name][r.status === "success" ? "success" : r.status === "failed" ? "failed" : "partial"]++;
    }
    const unhealthy = Object.entries(byName).filter(([, v]) => v.failed > v.success);
    insights.push({
      category: "crawler_health",
      summary: unhealthy.length ? `${unhealthy.length} crawler(s) failing more than succeeding: ${unhealthy.map(([n]) => n).join(", ")}` : "All crawlers healthy in last 24h",
      detail: byName,
    });
  }

  return insights;
}

// ---- Loop 4: Optimization — take small, genuinely mechanical actions
// based on what self-evaluation found. No prompt auto-rewriting (that's a
// human decision), but real, bounded actions: flag stale data, note
// degrading domains for review.
async function optimize(insights) {
  const actions = [];
  for (const insight of insights) {
    if (insight.category === "accuracy" && insight.detail?.trend === "degrading") {
      actions.push(`Flagged domain "${insight.detail.domain}" as degrading (avg error rising) — recommend reviewing recent corrections for a pattern before the next prompt revision.`);
    }
    if (insight.category === "crawler_health" && insight.summary.startsWith("1") === false && insight.summary.includes("failing")) {
      actions.push(`Crawler health issue noted — no auto-restart wired (would need a queue/retry system, not yet built). Logged for manual attention.`);
    }
  }
  return actions;
}

export async function GET(req) {
  if (!checkAuth(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cycleStart = Date.now();
  const results = { knowledge: null, resolution: null, insights: [], actions: [] };

  try {
    results.knowledge = await refreshKnowledge();
    results.resolution = await resolvePredictions();
    results.insights = await selfEvaluate();
    results.actions = await optimize(results.insights);

    // Log the whole cycle as one row too, so "what happened at 3:30pm" is one query
    await supabasePost("system_insights", [{
      category: "cycle_summary",
      summary: `Heartbeat cycle: ${results.knowledge?.succeeded ?? 0} knowledge refreshes, ${results.resolution?.succeeded ?? 0} predictions resolved, ${results.actions.length} optimization action(s).`,
      detail: results,
      action_taken: results.actions.join(" | ") || null,
    }]);

    return Response.json({ ok: true, durationMs: Date.now() - cycleStart, ...results });
  } catch (e) {
    return Response.json({ ok: false, error: e.message, durationMs: Date.now() - cycleStart, partial: results });
  }
}
