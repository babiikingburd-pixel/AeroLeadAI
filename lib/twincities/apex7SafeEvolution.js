// Seven-pass improvement layer: proposals are evaluated, never silently
// deployed. A proposal must have enough observations, measurable gains, and
// an explicit approval before it can be promoted.
export const MIN_OBSERVATIONS = 30;
export const MIN_IMPROVEMENT = 0.03;

export function evaluateExperiment({ baseline = {}, candidate = {}, observations = 0 } = {}) {
  if (observations < MIN_OBSERVATIONS) return { eligible: false, reason: "insufficient_observations" };
  const base = Number(baseline.composite ?? 0);
  const next = Number(candidate.composite ?? 0);
  const improvement = base === 0 ? 0 : (next - base) / Math.abs(base);
  return { eligible: improvement >= MIN_IMPROVEMENT, improvement, baseline: base, candidate: next };
}

export function proposalGate({ experiment, testsPassed = false, approved = false } = {}) {
  if (!experiment?.eligible) return { status: "rejected", reason: "experiment_not_eligible" };
  if (!testsPassed) return { status: "tests_required" };
  if (!approved) return { status: "queued_for_review" };
  return { status: "approved_for_deploy" };
}
