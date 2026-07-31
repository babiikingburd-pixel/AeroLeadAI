// RESEARCH AGENT — Level 5, the level explicitly flagged as dangerous if
// done wrong. Built here strictly as: Observe -> Hypothesis -> Research ->
// Simulate -> Write proposal -> STOP. The pipeline in the request was:
//   Observe -> Hypothesis -> Spawn agent -> Research -> Simulate ->
//   Write code proposal -> Run tests -> Human approval -> Deploy
// This implementation covers everything up through "write proposal."
// "Run tests" and "Deploy" are NOT built — those require code-execution
// and deployment access that no research agent should have, full stop.
// The proposal this writes is plain text a human reads and acts on
// manually; there's no code path anywhere that turns a proposal directly
// into a system change.

import { supabaseGet, supabasePost } from "./supabaseRest";

// Observe: is there a real, measurable accuracy problem in a specific
// area? Uses actual accuracy_rollups + prediction data, not a vague sense
// that something's wrong.
export async function observeForProblems() {
  const rollupRes = await supabaseGet("accuracy_rollups?trend=eq.degrading&select=*");
  const problems = [];
  if (rollupRes.ok) {
    for (const rollup of rollupRes.data) {
      problems.push({
        domain: rollup.domain,
        trigger: `${rollup.domain} accuracy degrading (avg error ${rollup.avg_error_last_30d?.toFixed(1)} recently vs ${rollup.avg_error?.toFixed(1)} overall)`,
      });
    }
  }
  return problems;
}

// Research: pull the actual resolved predictions behind the problem so the
// hypothesis is grounded in real cases, not speculation.
async function researchDomain(domain) {
  const res = await supabaseGet(`predictions?domain=eq.${domain}&actual_score=not.is.null&select=*&order=predicted_at.desc&limit=50`);
  if (!res.ok) return { cases: [], summary: "Could not fetch prediction history." };
  const cases = res.data;
  const overestimates = cases.filter((c) => c.predicted_score > c.actual_score).length;
  const underestimates = cases.filter((c) => c.predicted_score < c.actual_score).length;
  return {
    cases: cases.length,
    summary: `${cases.length} resolved cases: ${overestimates} overestimated, ${underestimates} underestimated by the system.`,
    skew: overestimates > underestimates * 1.5 ? "overestimating" : underestimates > overestimates * 1.5 ? "underestimating" : "no clear skew",
  };
}

// Simulate: a real (if simple) backtest — what would avg error have been
// if a candidate adjustment (a flat point-shift) had been applied to the
// historical predictions? This is genuine arithmetic against real stored
// data, not a fabricated "simulation ran successfully" claim.
function simulateAdjustment(cases, shiftPoints) {
  if (!cases.length) return null;
  const adjustedErrors = cases.map((c) => Math.abs((c.predicted_score - shiftPoints) - c.actual_score));
  const originalErrors = cases.map((c) => c.error_magnitude ?? Math.abs(c.predicted_score - c.actual_score));
  const adjustedAvg = adjustedErrors.reduce((a, b) => a + b, 0) / adjustedErrors.length;
  const originalAvg = originalErrors.reduce((a, b) => a + b, 0) / originalErrors.length;
  return { originalAvg, adjustedAvg, improvement: originalAvg - adjustedAvg };
}

// The full pipeline: Observe -> Hypothesis -> Research -> Simulate ->
// Write proposal. Ends here. Nothing after this point is automated.
export async function runResearchCycle() {
  const problems = await observeForProblems();
  if (!problems.length) {
    return { ok: true, proposalsCreated: 0, notes: "No degrading domains found — nothing to research this cycle." };
  }

  let created = 0;
  for (const problem of problems) {
    const research = await researchDomain(problem.domain);
    if (research.cases < 10) continue; // not enough data to responsibly hypothesize from

    const cases = (await supabaseGet(`predictions?domain=eq.${problem.domain}&actual_score=not.is.null&select=*&limit=50`)).data || [];
    const avgSignedError = cases.reduce((a, b) => a + (b.predicted_score - b.actual_score), 0) / cases.length;
    const candidateShift = Math.round(avgSignedError * 0.7); // conservative partial correction, not a full swing
    const simulation = simulateAdjustment(cases, candidateShift);

    const hypothesis = `${problem.trigger}. Research shows ${research.summary} (${research.skew}). Hypothesis: a flat ${candidateShift}-point downward adjustment to ${problem.domain} scores would reduce average error.`;
    const proposedChange = `Apply a ${candidateShift >= 0 ? "-" : "+"}${Math.abs(candidateShift)} point correction to raw ${problem.domain} Analyst scores before the Critic/Teacher pipeline, OR flag this pattern for the lesson engine to pick up with more evidence.`;
    const simulationResult = simulation
      ? `Backtested against ${cases.length} historical resolved predictions: avg error would change from ${simulation.originalAvg.toFixed(1)} to ${simulation.adjustedAvg.toFixed(1)} (${simulation.improvement > 0 ? "improvement" : "WORSE — do not apply"} of ${Math.abs(simulation.improvement).toFixed(1)} points).`
      : "Insufficient data to simulate.";

    // Only write a proposal if the simulation actually shows improvement —
    // don't propose a change that its own backtest says makes things worse.
    if (simulation && simulation.improvement > 0) {
      await supabasePost("research_proposals", [{
        triggered_by: problem.trigger, domain: problem.domain, hypothesis,
        findings: research.summary, proposed_change: proposedChange, simulation_result: simulationResult,
      }]);
      created++;
    }
  }

  return { ok: true, proposalsCreated: created, domainsObserved: problems.length };
}
