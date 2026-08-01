// lib/twincities/evidenceAudit.js
//
// Answers "why did this house score a 94?" from data already computed by
// priorityEngine.js — no re-deriving the math, just reading back what was
// persisted to batch_leads.evidence_breakdown. Keep this a thin, pure
// function: if the breakdown shape ever changes, it changes in
// priorityEngine.js and this file doesn't need touching.

/**
 * @param {object} lead - a batch_leads row (or the object returned by
 *   calculatePriority merged onto one) with evidence_breakdown / breakdown,
 *   evidence_score, confidence_score, priority_score present.
 * @returns {object} flat, machine-readable explanation safe to show a
 *   contractor or return from an API without further processing.
 */
export function explainScore(lead) {
  const breakdown = lead.evidence_breakdown || lead.breakdown || {};
  return {
    address: lead.address ?? null,
    evidence_score: lead.evidence_score ?? lead.evidenceScore ?? 0,
    confidence_score: lead.confidence_score ?? lead.confidenceScore ?? 0,
    priority_score: lead.priority_score ?? lead.priorityScore ?? 0,
    review_status: lead.review_status ?? lead.reviewStatus ?? "pending",
    breakdown: {
      maturity: breakdown.maturity ?? 0,
      hail: breakdown.hail ?? 0,
      wind: breakdown.wind ?? 0,
      heavy_snow: breakdown.heavy_snow ?? 0,
      heavy_rain: breakdown.heavy_rain ?? 0,
      tree_overhang: breakdown.tree_overhang ?? 0,
      large_overhang: breakdown.large_overhang ?? 0,
      driveway: breakdown.driveway ?? 0,
      gutter: breakdown.gutter ?? 0,
      county_multiplier: breakdown.county_multiplier ?? 1.0,
    },
  };
}
