// TIER: LOW — runs once daily (see vercel.json). This is the "daily
// services" tier from the request.
//
// NOTE ON WHAT'S NOT DUPLICATED HERE: "generate lessons learned" and
// "retire ineffective agents" are already covered by /api/lesson-engine's
// existing nightly cron (0 6 * * *) — it already calls the lesson engine
// AND the evolution engine. Running that logic twice a day from two
// different endpoints would be redundant, not more thorough. "Recalculate
// county rankings" is handled by /api/tier-medium's neighborhoodTrends
// (every 6h, which is a strict superset of doing it once daily).
//
// What's actually NEW and belongs here: "create new agent candidates."
// HONEST IMPLEMENTATION: this does NOT invent a novel strategy from
// nothing — that would require the AI to write new logic, which this
// system deliberately never does (see supabase_agent_factory_schema.sql).
// What it does instead, genuinely: find the best-surviving active agent by
// real success rate, and clone it forward one generation (same tools,
// same goal, generation+1, parent_agent_id set). That's "the system
// evolves its workforce" implemented honestly — propagate what's actually
// working, bounded by the exact same global caps (active-agent count,
// daily spend) as any other agent creation.

import { supabaseGet } from "../../../lib/supabaseRest";
import { withCrawlerLog } from "../../../lib/crawlerLog";
import { planCycle } from "../../../lib/planner";
import { create, listActive, evaluate } from "../../../lib/agentFactory";

export const maxDuration = 60;

function checkAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret || req.headers.get("authorization") === `Bearer ${secret}`;
}

async function lowPriorityRescan(baseUrl) {
  return withCrawlerLog("tier_low_rescan", async () => {
    const plan = await planCycle("low", 20); // largest cap of the three tiers — cheapest per-item work (permit check only)
    let succeeded = 0, failed = 0;
    const errors = [];
    for (const candidate of plan.rescanCandidates) {
      try {
        const res = await fetch(`${baseUrl}/api/permit-lookup?address=${encodeURIComponent(candidate.address)}`);
        if (res.ok) succeeded++; else failed++;
      } catch (e) {
        failed++;
        errors.push(`${candidate.address}: ${e.message}`);
      }
    }
    return { succeeded, failed, errors, planReasons: plan.reasons };
  });
}

// Clone the best-surviving agent forward a generation. Only acts if there's
// at least one active agent with enough runs to trust its success rate —
// won't clone a brand-new agent that just hasn't had a chance to prove itself.
const MIN_RUNS_TO_CLONE = 10;

async function proposeNewAgentGeneration() {
  const active = await listActive();
  if (!active.length) return { cloned: false, notes: "No active agents to evaluate for cloning." };

  const evaluated = await Promise.all(active.map(async (a) => ({ agent: a, stats: await evaluate(a.agent_id) })));
  const eligible = evaluated.filter((e) => e.stats.totalRuns >= MIN_RUNS_TO_CLONE);
  if (!eligible.length) return { cloned: false, notes: `No agent has ${MIN_RUNS_TO_CLONE}+ runs yet — too early to trust a success rate enough to propagate it.` };

  eligible.sort((a, b) => (b.stats.successRate ?? 0) - (a.stats.successRate ?? 0));
  const best = eligible[0];

  if ((best.stats.successRate ?? 0) < 0.5) {
    return { cloned: false, notes: `Best agent's success rate (${((best.stats.successRate ?? 0) * 100).toFixed(0)}%) is below 50% — not worth propagating a losing pattern.` };
  }

  const result = await create({
    name: `${best.agent.name}_gen${(best.agent.generation || 1) + 1}`,
    goal: best.agent.goal,
    tools: best.agent.tools,
    budget: best.agent.budget,
    lifetime_hours: best.agent.lifetime_hours,
    generation: (best.agent.generation || 1) + 1,
    parent_agent_id: best.agent.agent_id,
  });

  return result.ok
    ? { cloned: true, newAgent: result.agent, clonedFrom: best.agent.name, successRate: best.stats.successRate }
    : { cloned: false, notes: `Cloning blocked: ${result.error}` }; // e.g. global caps hit — a real, expected outcome, not an error to hide
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const rescanResult = await lowPriorityRescan(baseUrl);
  const cloneResult = await proposeNewAgentGeneration();

  return Response.json({ ok: true, tier: "low", rescanResult, newAgentGeneration: cloneResult });
}
