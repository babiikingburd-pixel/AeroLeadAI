"""
engines/human_review.py

review = (evidence >= 80) or (confidence <= 60) or (opportunity_normalized >= 75)

Takes opportunity's NORMALIZED (0-100) score, not the raw dollar figure —
see opportunity_engine.py's docstring for why the raw figure can't be
compared against a 0-100 threshold.
"""

from constants import (
    EVIDENCE_REVIEW_THRESHOLD,
    CONFIDENCE_REVIEW_THRESHOLD,
    OPPORTUNITY_REVIEW_THRESHOLD,
)


def requires_review(evidence: int, confidence: int, opportunity_normalized: int) -> dict:
    reasons = []
    if evidence >= EVIDENCE_REVIEW_THRESHOLD:
        reasons.append(f"evidence {evidence} >= {EVIDENCE_REVIEW_THRESHOLD}")
    if confidence <= CONFIDENCE_REVIEW_THRESHOLD:
        reasons.append(f"confidence {confidence} <= {CONFIDENCE_REVIEW_THRESHOLD}")
    if opportunity_normalized >= OPPORTUNITY_REVIEW_THRESHOLD:
        reasons.append(f"opportunity {opportunity_normalized} >= {OPPORTUNITY_REVIEW_THRESHOLD}")

    return {"review_required": len(reasons) > 0, "reasons": reasons}
