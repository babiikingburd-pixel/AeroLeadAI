const costMap = {
  FETCH_EAGLEVIEW: 2.50,
  FIND_HISTORICAL_IMAGE: 1.25,
  CROSS_CHECK_EVIDENCE: .20,
  FILL_EVIDENCE_GAPS: .35,
  RESOLVE_CONTRADICTIONS: .40,
  NEIGHBORHOOD_XRAY: .25,
  FIELD_REVIEW: 18,
  CAPTURE_OUTCOME: 2
};

export function missionEconomics(queue=[], property={}, opts={}) {
  const estimatedJobValue = Number(property.estimated_job_value || property.estimatedJobValue || opts.defaultJobValue || 12000);
  const closeProbability = Math.max(0, Math.min(1, Number(property.close_probability || opts.closeProbability || .12)));
  const expectedValue = estimatedJobValue * closeProbability;
  const planned = queue.map(x => ({...x, estimatedCost: costMap[x.type] ?? .15}));
  const researchCost = planned.reduce((a,x)=>a+x.estimatedCost,0);
  const ratio = researchCost > 0 ? expectedValue / researchCost : 999;
  return {
    expectedValue: Math.round(expectedValue),
    estimatedResearchCost: Number(researchCost.toFixed(2)),
    valueToResearchRatio: Number(ratio.toFixed(1)),
    recommendation: ratio >= 20 ? "SPEND" : ratio >= 8 ? "LIMIT" : "HOLD",
    planned
  };
}
