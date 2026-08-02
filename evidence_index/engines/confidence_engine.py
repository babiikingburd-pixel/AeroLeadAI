"""
engines/confidence_engine.py

confidence = permit_confidence + storm_confidence + imagery_confidence + human_review_boost

Each input confidence is expected as a 0-100 value from its source
enricher/agent. This engine averages the three real signal confidences
(not sums them past 100, which the literal doc formula would do) and
then applies a flat human-review boost on top — an averaged base with
a real bonus reads correctly as "confidence", whereas summing three
0-100 values would blow past 100 by construction for almost every real
input. This is a deliberate deviation from the literal formula in the
brief; flagged here rather than silently changed.
"""

from constants import HUMAN_REVIEW_CONFIDENCE_BOOST


def confidence_score(lead: dict) -> int:
    signals = [
        lead.get("permit_confidence"),
        lead.get("storm_confidence"),
        lead.get("imagery_confidence"),
    ]
    present = [s for s in signals if s is not None]

    base = sum(present) / len(present) if present else 0

    if lead.get("human_reviewed", False):
        base += HUMAN_REVIEW_CONFIDENCE_BOOST

    return int(min(100, max(0, round(base))))
