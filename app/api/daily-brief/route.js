// DAILY BRIEF — answers the five questions the request said are what
// actually separate "running 24/7" from "getting better over time." Every
// answer here is pulled from data this system already has and already
// writes for other reasons — nothing new is invented to answer these.
//
//   1. What did I learn today?        -> learned_lessons + experiments confirmed today
//   2. Which predictions were wrong?  -> corrections submitted today, with the actual delta
//   3. Which strategy made the most money? -> HONESTLY: no revenue data exists.
//      Real proxy used instead: which agent/goal produced the most hot
//      leads (score >=75) via agent_genome — stated as a proxy, not revenue.
//   4. What experiment should I run next? -> real 'testing' rows from
//      experiments table (Scientist Agent's open hypotheses), oldest first
//   5. Should I create or retire an agent? -> a live call to
//      evolutionEngine.evaluateGeneration(), reporting any agent already
//      at 0% success (retire candidate) or eligible for cloning (create
//      candidate) — the same logic tier-low's cron runs, exposed here as a
//      read-only report so a human can see the reasoning without waiting
//      for the next scheduled run.

import { supabaseGet } from "../../../lib/supabaseRest";
export const dynamic = "force-dynamic";

function checkAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret || req.headers.get("authorization") === `Bearer ${secret}`;
}

async function whatDidILearnToday() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [lessonsRes, experimentsRes] = await Promise.all([
    supabaseGet(`learned_lessons?created_at=gte.${since}&select=lesson,evidence_count,confidence`),
    supabaseGet(`lesson_experiments?resolved_at=gte.${since}&status=eq.confirmed&select=hypothesis,current_effect_size`),
  ]);
  return {
    newLessons: lessonsRes.ok ? lessonsRes.data : [],
    confirmedExperiments: experimentsRes.ok ? experimentsRes.data : [],
  };
}

async function whichPredictionsWereWrong() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const res = await supabaseGet(`corrections?created_at=gte.${since}&select=address_normalized,domain,original_score,corrected_score,reason&order=created_at.desc`);
  if (!res.ok) return [];
  return res.data.map((c) => ({ ...c, delta: (c.corrected_score ?? 0) - (c.original_score ?? 0) }));
}

async function bestStrategyProxy() {
  const res = await supabaseGet("agent_genome?select=*&order=evaluated_at.desc&limit=50");
  if (!res.ok || !res.data.length) return { notes: "No agent genome data yet — no agents have been evaluated." };
  const byStrategy = {};
  for (const g of res.data) {
    byStrategy[g.strategy] = byStrategy[g.strategy] || { hotLeads: 0, scanned: 0, count: 0 };
    byStrategy[g.strategy].hotLeads += g.hot_leads_found || 0;
    byStrategy[g.strategy].scanned += g.properties_scanned || 0;
    byStrategy[g.strategy].count++;
  }
  const ranked = Object.entries(byStrategy).map(([strategy, s]) => ({ strategy, ...s })).sort((a, b) => b.hotLeads - a.hotLeads);
  return {
    ranked,
    notes: "Ranked by hot leads found (proxy metric — no real revenue/close data exists in this system, so this is NOT actual dollars, just a measurable stand-in until a CRM connector exists.)",
  };
}

async function nextExperiment() {
  const res = await supabaseGet("lesson_experiments?status=eq.testing&select=*&order=started_at.asc&limit=5");
  if (!res.ok) return { notes: "Could not fetch experiments." };
  if (!res.data.length) return { notes: "No open experiments — the lesson engine hasn't found a new borderline pattern to test since the last one resolved." };
  return { openExperiments: res.data, notes: `${res.data.length} hypothesis(es) currently being re-measured, oldest listed first.` };
}

async function agentDecision() {
  try {
    const { evaluateGeneration } = await import("../../../lib/evolutionEngine");
    const genome = await evaluateGeneration();
    const failing = genome.filter((g) => g._factoryStats?.totalRuns >= 5 && g._factoryStats?.successRate === 0);
    const cloneCandidate = genome
      .filter((g) => g._factoryStats?.totalRuns >= 10)
      .sort((a, b) => (b._factoryStats?.successRate ?? 0) - (a._factoryStats?.successRate ?? 0))[0];
    return {
      retireCandidates: failing.map((f) => ({ agent_id: f.agent_id, strategy: f.strategy, runs: f._factoryStats.totalRuns })),
      cloneCandidate: cloneCandidate ? { agent_id: cloneCandidate.agent_id, strategy: cloneCandidate.strategy, successRate: cloneCandidate._factoryStats.successRate } : null,
      notes: "This is the same decision logic the daily tier-low cron acts on automatically — shown here read-only so it's checkable without waiting for the next run.",
    };
  } catch (e) {
    return { notes: `Could not evaluate agent generation: ${e.message}` };
  }
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [learned, wrongPredictions, strategy, experiment, agents] = await Promise.all([
    whatDidILearnToday(), whichPredictionsWereWrong(), bestStrategyProxy(), nextExperiment(), agentDecision(),
  ]);

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    q1_whatDidILearnToday: learned,
    q2_whichPredictionsWereWrong: wrongPredictions,
    q3_bestStrategyProxy: strategy,
    q4_nextExperiment: experiment,
    q5_agentCreateOrRetire: agents,
  });
}
