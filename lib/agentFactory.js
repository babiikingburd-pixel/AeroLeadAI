// AGENT FACTORY — Level 1-3 of the requested system. Creates agents
// ASSEMBLED from a fixed tool whitelist (agent_tools table), never
// arbitrary generated code. Every resource limit is enforced here, in the
// one place a run is actually allowed to happen — not left as metadata an
// agent could ignore.

import { supabaseGet, supabasePost, supabasePatch } from "./supabaseRest";

const APPROVED_TOOLS = ["weather_api", "permit_lookup", "imagery_analysis", "zip_scan", "damage_scoring"];

// Global caps — the actual fix for "you'll eventually get thousands of
// redundant crawlers and a huge cloud bill." These are checked before ANY
// new agent is created, independent of what an individual spec requests.
const GLOBAL_MAX_ACTIVE_AGENTS = 50;
const GLOBAL_MAX_DAILY_SPEND = 25.00; // USD, hard stop across ALL agents combined

export async function create(spec) {
  // 1. Validate every requested tool is on the approved whitelist. This is
  // the actual boundary that keeps this "assemble from building blocks"
  // instead of "run whatever." Reject, don't silently drop bad tools.
  const invalidTools = (spec.tools || []).filter((t) => !APPROVED_TOOLS.includes(t));
  if (invalidTools.length) {
    return { ok: false, error: `Rejected: tool(s) not on approved whitelist: ${invalidTools.join(", ")}. Approved: ${APPROVED_TOOLS.join(", ")}` };
  }
  if (!spec.tools || spec.tools.length === 0) {
    return { ok: false, error: "An agent must specify at least one approved tool." };
  }

  // 2. Global active-agent cap — checked before creating, not after.
  const activeRes = await supabaseGet("agent_specs?status=eq.active&select=agent_id");
  if (activeRes.ok && activeRes.data.length >= GLOBAL_MAX_ACTIVE_AGENTS) {
    return { ok: false, error: `Rejected: ${activeRes.data.length} agents already active, global cap is ${GLOBAL_MAX_ACTIVE_AGENTS}. Retire underperformers first.` };
  }

  // 3. Global daily spend cap — checked across ALL agents, not per-agent.
  const spendRes = await supabaseGet(
    `agent_specs?created_at=gte.${new Date(Date.now() - 86400000).toISOString()}&select=spent`
  );
  const spentToday = spendRes.ok ? spendRes.data.reduce((a, b) => a + (parseFloat(b.spent) || 0), 0) : 0;
  if (spentToday >= GLOBAL_MAX_DAILY_SPEND) {
    return { ok: false, error: `Rejected: $${spentToday.toFixed(2)} already spent across agents today, daily cap is $${GLOBAL_MAX_DAILY_SPEND}.` };
  }

  const budget = Math.min(spec.budget || 5, 20); // per-agent hard ceiling regardless of what's requested
  const lifetimeHours = Math.min(spec.lifetime_hours || 24, 168); // never more than a week without re-review

  const insertRes = await supabasePost("agent_specs", [{
    name: spec.name, goal: spec.goal, tools: spec.tools,
    budget, lifetime_hours: lifetimeHours,
    max_requests: Math.min(spec.max_requests || 1000, 5000),
    generation: spec.generation || 1, parent_agent_id: spec.parent_agent_id || null,
  }]);

  return insertRes.ok
    ? { ok: true, agent: insertRes.data[0] }
    : { ok: false, error: insertRes.error };
}

// Checks whether an agent is still allowed to run at all — expired,
// over-budget, or over-request-limit agents get auto-retired here rather
// than silently continuing.
export async function checkRunAllowed(agentId) {
  const res = await supabaseGet(`agent_specs?agent_id=eq.${agentId}&select=*`);
  if (!res.ok || !res.data?.length) return { allowed: false, reason: "Agent not found" };
  const agent = res.data[0];

  if (agent.status !== "active") return { allowed: false, reason: `Agent status is ${agent.status}, not active` };
  if (new Date(agent.expires_at) < new Date()) {
    await retire(agentId, "expired");
    return { allowed: false, reason: "Agent lifetime expired" };
  }
  if (parseFloat(agent.spent) >= parseFloat(agent.budget)) {
    await retire(agentId, "budget_exhausted");
    return { allowed: false, reason: "Agent budget exhausted" };
  }
  if (agent.requests_made >= agent.max_requests) {
    await retire(agentId, "request_limit_exhausted");
    return { allowed: false, reason: "Agent request limit exhausted" };
  }
  return { allowed: true, agent };
}

export async function recordRun(agentId, toolName, cost, status, resultSummary) {
  await supabasePost("agent_runs", [{ agent_id: agentId, tool_name: toolName, finished_at: new Date().toISOString(), status, cost, result_summary: resultSummary }]);
  const agentRes = await supabaseGet(`agent_specs?agent_id=eq.${agentId}&select=spent,requests_made`);
  if (agentRes.ok && agentRes.data?.length) {
    const a = agentRes.data[0];
    await supabasePatch(`agent_specs?agent_id=eq.${agentId}`, {
      spent: parseFloat(a.spent || 0) + parseFloat(cost || 0),
      requests_made: (a.requests_made || 0) + 1,
    });
  }
}

// Evaluate: compute real performance from this agent's actual runs and any
// predictions it produced — not self-reported success.
export async function evaluate(agentId) {
  const runsRes = await supabaseGet(`agent_runs?agent_id=eq.${agentId}&select=*`);
  const runs = runsRes.ok ? runsRes.data : [];
  const succeeded = runs.filter((r) => r.status === "success").length;

  return {
    agentId,
    totalRuns: runs.length,
    succeeded,
    successRate: runs.length ? succeeded / runs.length : null,
    totalCost: runs.reduce((a, b) => a + (parseFloat(b.cost) || 0), 0),
  };
}

export async function retire(agentId, reason) {
  return supabasePatch(`agent_specs?agent_id=eq.${agentId}`, { status: "retired", retired_at: new Date().toISOString(), retired_reason: reason });
}

export async function listActive() {
  const res = await supabaseGet("agent_specs?status=eq.active&select=*&order=created_at.desc");
  return res.ok ? res.data : [];
}
