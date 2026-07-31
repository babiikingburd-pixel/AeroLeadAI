// Read-only view into the autonomy system's own state — what it last
// learned, current accuracy per domain, and crawler health. This is what
// makes the whole thing inspectable instead of a black box running
// invisibly in the background.

import { supabaseGet } from "../../../lib/supabaseRest";

export async function GET() {
  const [lastCycle, accuracy, recentRuns, recentInsights] = await Promise.all([
    supabaseGet("system_insights?category=eq.cycle_summary&order=cycle_at.desc&limit=1"),
    supabaseGet("accuracy_rollups?select=*&order=domain"),
    supabaseGet("crawler_runs?order=started_at.desc&limit=20"),
    supabaseGet("system_insights?order=cycle_at.desc&limit=10"),
  ]);

  if (lastCycle.notConfigured) {
    return Response.json({ ok: false, notConfigured: true, notes: "Supabase not configured — autonomy loop has nowhere to write its memory." });
  }

  return Response.json({
    ok: true,
    lastCycle: lastCycle.data?.[0] || null,
    accuracyByDomain: accuracy.data || [],
    recentCrawlerRuns: recentRuns.data || [],
    recentInsights: recentInsights.data || [],
  });
}
