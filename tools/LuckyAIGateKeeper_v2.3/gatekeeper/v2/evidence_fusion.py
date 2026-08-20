"""Evidence fusion with conservative rules and explicit contradiction handling."""
from typing import Any, Dict, Iterable, List, Tuple
from gatekeeper.models import Evidence

def fuse(evidence: Iterable[Evidence]) -> Dict[str, Any]:
    items = list(evidence)
    verified = [e for e in items if e.verified and e.confidence >= .80]
    positive = [e for e in items if e.kind in {"observation", "positive", "verified"} and e.verified]
    negative = [e for e in items if e.kind in {"failure", "negative", "contradiction"} or (not e.verified and e.confidence >= .70 and e.kind != "diagnostic_failure")]
    contradiction = bool(positive and negative)
    support = sum(max(0.0, min(1.0, e.confidence)) for e in verified)
    confidence = min(.99, support / max(1, len(verified)) if verified else .0)
    if contradiction: confidence = min(confidence, .74)
    return {
        "evidence_count": len(items),
        "verified_count": len(verified),
        "positive_count": len(positive),
        "negative_count": len(negative),
        "contradiction": contradiction,
        "confidence": round(confidence, 3),
    }
