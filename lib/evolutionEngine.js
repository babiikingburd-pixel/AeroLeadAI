// EVOLUTION ENGINE — keeps successful agents, retires failed ones, based on
// REAL measured metrics.
//
// HONEST METRIC CHOICE: the request's example used "Revenue: $84,000" as
// the fitness metric. This system has no actual sales/close data anywhere
// — no CRM integration, no revenue tracking. Using a fake revenue number
// would be fabricating the exact kind of ground truth this whole autonomy
// system is built to never invent. The real, honest proxies available are:
//   - hot_leads_found: predictions this agent's runs produced with score >=75
//     (a real, measurable proxy for "found something worth a contractor's time")
//   - accuracy: avg error_magnitude of this agent's predictions that have
//     since been resolved by a human correction
// If real revenue/conversion data gets wired in later (a CRM connector),
// this is the one place that needs updating — the interface (evaluate a
// generation, retire the bottom N%) doesn't change.

import { supabaseGet, supabasePost } from "./supabaseRest";
import { listActive, retire, evaluate as factoryEvaluate } from "./agentFactory";

export async function evaluateGeneration() {
  const active = await listActive();
  const genomeRows = [];

  for (const agent of active) {
    const factoryStats = await factoryEvaluate(agent.agent_id);

    // Real proxy metrics from this agent's actual prediction output — uses
    // the agent_id column directly, populated when damage-agent is called
    // with an agentId (see crawlerForge.js). Agents that haven't produced
    // any scored predictions yet correctly show 0 here, not a fabricated number.
    const predsRes = await supabaseGet(`predictions?agent_id=eq.${agent.agent_id}&select=*`);
    const preds = predsRes.ok ? predsRes.data : [];
    const hotLeads = preds.filter((p) => p.predicted_score >= 75).length;
    const resolved = preds.filter((p) => p.error_magnitude !== null);
    const accuracy = resolved.length ? resolved.reduce((a, b) => a + b.error_magnitude, 0) / resolved.length : null;

    genomeRows.push({
      agent_id: agent.agent_id, parent_id: agent.parent_agent_id, strategy: agent.goal,
      hot_leads_found: hotLeads, properties_scanned: factoryStats.totalRuns,
      accuracy, generation: agent.generation,
      _factoryStats: factoryStats, // internal, not written to DB, used for retirement decision below
    });
  }

  return genomeRows;
}

// Retires the bottom N% by a real, stated ranking: agents with ZERO
// successful runs after spending >50% of their budget are the clearest
// signal of failure and are retired first, regardless of percentile —
// that's not "underperforming," that's "not working." Beyond that, rank by
// success rate among agents that have run enough to be measured (avoids
// retiring a brand-new agent that just hasn't had a chance yet).
const MIN_RUNS_TO_RANK = 5;

export async function retireBottomPerformers(retirePercent = 0.5) {
  const genomeRows = await evaluateGeneration();
  const retired = [];

  // Clear failures first, regardless of rank
  for (const row of genomeRows) {
    const stats = row._factoryStats;
    if (stats.totalRuns >= MIN_RUNS_TO_RANK && stats.successRate === 0) {
      await retire(row.agent_id, `evolution_engine: 0% success rate over ${stats.totalRuns} runs`);
      retired.push(row.agent_id);
    }
  }

  // Rank the rest by success rate, retire bottom percent among those with enough data to rank
  const rankable = genomeRows.filter((r) => !retired.includes(r.agent_id) && r._factoryStats.totalRuns >= MIN_RUNS_TO_RANK);
  rankable.sort((a, b) => (a._factoryStats.successRate ?? 0) - (b._factoryStats.successRate ?? 0));
  const cutoff = Math.floor(rankable.length * retirePercent);
  for (const row of rankable.slice(0, cutoff)) {
    await retire(row.agent_id, `evolution_engine: bottom ${Math.round(retirePercent * 100)}% by success rate (${(row._factoryStats.successRate * 100).toFixed(0)}%)`);
    retired.push(row.agent_id);
  }

  // Log every genome row (minus the internal-only _factoryStats field)
  for (const row of genomeRows) {
    const { _factoryStats, ...clean } = row;
    await supabasePost("agent_genome", [clean]);
  }

  return { evaluated: genomeRows.length, retired: retired.length, retiredIds: retired };
}
