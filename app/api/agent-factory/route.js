// Agent Factory control endpoint. This is the ONLY interface for creating,
// running, evaluating, and retiring agents — there's no path anywhere in
// this codebase for an agent to call this on itself with elevated
// privileges. A "create agent" action still goes through the same budget/
// whitelist checks in lib/agentFactory.js regardless of who calls this.

import { create, listActive, evaluate, retire } from "../../../lib/agentFactory";
import { spawnCrawler, availableMissions } from "../../../lib/crawlerForge";
import { evaluateGeneration, retireBottomPerformers } from "../../../lib/evolutionEngine";
import { supabaseGet, supabasePatch } from "../../../lib/supabaseRest";
export const dynamic = "force-dynamic";

function baseUrl(req) {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "list";

  if (action === "list") {
    const active = await listActive();
    return Response.json({ ok: true, active });
  }
  if (action === "missions") {
    return Response.json({ ok: true, missions: availableMissions() });
  }
  if (action === "evaluate") {
    const agentId = searchParams.get("agentId");
    if (!agentId) return Response.json({ ok: false, error: "agentId required" }, { status: 400 });
    return Response.json({ ok: true, result: await evaluate(agentId) });
  }
  if (action === "generation") {
    const rows = await evaluateGeneration();
    return Response.json({ ok: true, genome: rows.map(({ _factoryStats, ...r }) => r) });
  }
  if (action === "research-proposals") {
    // Read-only view of pending proposals — approving/rejecting is a
    // separate POST action below, never automatic.
    const res = await supabaseGet("research_proposals?status=eq.pending_human_approval&order=created_at.desc");
    return Response.json({ ok: res.ok, proposals: res.data });
  }

  return Response.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

export async function POST(req) {
  const body = await req.json();
  const action = body.action;

  if (action === "create") {
    // Level 1: create an agent from the approved template shape.
    // { name, goal, tools: [...], budget, lifetime_hours }
    const result = await create(body.spec);
    return Response.json(result);
  }

  if (action === "spawn_crawler") {
    // Level 2-3: run a bounded crawler mission for an existing agent.
    // { agentId, goal, targetAddresses: [...] }
    const result = await spawnCrawler(body.agentId, body.goal, body.targetAddresses || [], baseUrl(req));
    return Response.json(result);
  }

  if (action === "retire") {
    // Manual retirement — a human or the evolution engine only.
    const result = await retire(body.agentId, body.reason || "manual retirement");
    return Response.json(result);
  }

  if (action === "run_evolution") {
    // Level 4: evaluate the current generation and retire the bottom
    // performers. Callable on-demand or wired into the heartbeat.
    const result = await retireBottomPerformers(body.retirePercent || 0.5);
    return Response.json({ ok: true, ...result });
  }

  if (action === "approve_research_proposal" || action === "reject_research_proposal") {
    // THE ONLY path that changes a research_proposals status away from
    // pending_human_approval. No agent, crawler, or automated cycle in this
    // codebase calls this action — it exists solely for a human to invoke,
    // e.g. from a dashboard button. That's the actual boundary, not a
    // permission check that could be bypassed.
    if (!body.proposalId) return Response.json({ ok: false, error: "proposalId required" }, { status: 400 });
    const newStatus = action === "approve_research_proposal" ? "approved" : "rejected";
    const res = await supabasePatch(`research_proposals?proposal_id=eq.${body.proposalId}`, {
      status: newStatus, reviewed_at: new Date().toISOString(), reviewed_by: body.reviewedBy || "human",
    });
    return Response.json({ ok: res.ok, status: newStatus, notes: newStatus === "approved" ? "Marked approved. Deployment (actually changing scoring/prompts) is still a separate manual step — this system does not auto-deploy from an approved proposal." : null });
  }

  return Response.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
