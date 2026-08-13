from typing import Iterable, List
from gatekeeper.models import Evidence


def normalize(evidence: Iterable[Evidence]) -> List[Evidence]:
    out = []
    for e in evidence:
        e.confidence = max(0.0, min(1.0, float(e.confidence)))
        out.append(e)
    return out


def verification_summary(evidence: Iterable[Evidence]):
    ev = normalize(evidence)
    return {
        "count": len(ev),
        "verified": sum(1 for e in ev if e.verified),
        "average_confidence": round(sum(e.confidence for e in ev) / len(ev), 3) if ev else 0.0,
        "sources": sorted(set(e.source for e in ev)),
    }
