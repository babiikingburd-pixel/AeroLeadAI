// lib/evidenceIndex/engines/confidenceEngine.js
//
// confidence = average(permitConfidence, stormConfidence, imageryConfidence) + humanReviewBoost
//
// Ported from evidence_index/ Python prototype's engines/confidence_engine.py,
// unchanged. Each input confidence is expected as a 0-100 value from its
// source enricher/agent. This averages the real signal confidences that are
// actually present (not summed past 100, which the literal spec formula
// would do) and then applies a flat human-review boost on top — an
// averaged base with a real bonus reads correctly as "confidence", whereas
// summing three 0-100 values would blow past 100 by construction for
// almost every real input.

import { HUMAN_REVIEW_CONFIDENCE_BOOST } from "../constants";

export function confidenceScore(lead) {
  const signals = [lead.permitConfidence, lead.stormConfidence, lead.imageryConfidence];
  const present = signals.filter((s) => s !== undefined && s !== null);

  let base = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0;

  if (lead.humanReviewed) base += HUMAN_REVIEW_CONFIDENCE_BOOST;

  return Math.min(100, Math.max(0, Math.round(base)));
}
