// lib/evidenceIndex/engines/humanReview.js
//
// review = (evidence >= 80) or (confidence <= 60) or (opportunityNormalized >= 75)
//
// Ported from evidence_index/ Python prototype's engines/human_review.py,
// unchanged. Takes opportunity's NORMALIZED (0-100) score, not the raw
// dollar figure — see opportunityEngine.js's docstring for why the raw
// figure can't be compared against a 0-100 threshold.

import { EVIDENCE_REVIEW_THRESHOLD, CONFIDENCE_REVIEW_THRESHOLD, OPPORTUNITY_REVIEW_THRESHOLD } from "../constants";

export function requiresReview(evidence, confidence, opportunityNormalized) {
  const reasons = [];
  if (evidence >= EVIDENCE_REVIEW_THRESHOLD) reasons.push(`evidence ${evidence} >= ${EVIDENCE_REVIEW_THRESHOLD}`);
  if (confidence <= CONFIDENCE_REVIEW_THRESHOLD) reasons.push(`confidence ${confidence} <= ${CONFIDENCE_REVIEW_THRESHOLD}`);
  if (opportunityNormalized >= OPPORTUNITY_REVIEW_THRESHOLD) reasons.push(`opportunity ${opportunityNormalized} >= ${OPPORTUNITY_REVIEW_THRESHOLD}`);

  return { reviewRequired: reasons.length > 0, reasons };
}
