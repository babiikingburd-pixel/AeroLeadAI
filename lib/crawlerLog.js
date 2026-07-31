import { supabasePost, supabasePatch } from "./supabaseRest";

// Wraps any crawler/job function with a real audit trail row in
// crawler_runs. This is what makes "which crawler failed?" an honest
// query instead of a guess — every run's actual start time, duration,
// item counts, and error (if any) get recorded, win or lose.
export async function withCrawlerLog(crawlerName, fn) {
  const start = Date.now();
  const insertRes = await supabasePost("crawler_runs", [{ crawler_name: crawlerName, status: "running" }]);
  const runId = insertRes.ok && insertRes.data?.[0]?.run_id;

  let result;
  try {
    result = await fn();
    const duration = Date.now() - start;
    if (runId) {
      await supabasePatch(`crawler_runs?run_id=eq.${runId}`, {
        finished_at: new Date().toISOString(),
        status: result.failed > 0 && result.succeeded === 0 ? "failed" : result.failed > 0 ? "partial" : "success",
        items_processed: (result.succeeded || 0) + (result.failed || 0),
        items_succeeded: result.succeeded || 0,
        items_failed: result.failed || 0,
        duration_ms: duration,
        error_summary: result.errors?.slice(0, 3).join("; ") || null,
      });
    }
    return { ...result, runId, durationMs: duration };
  } catch (e) {
    const duration = Date.now() - start;
    if (runId) {
      await supabasePatch(`crawler_runs?run_id=eq.${runId}`, {
        finished_at: new Date().toISOString(), status: "failed", duration_ms: duration, error_summary: e.message,
      });
    }
    return { ok: false, error: e.message, runId, durationMs: duration, succeeded: 0, failed: 1 };
  }
}
