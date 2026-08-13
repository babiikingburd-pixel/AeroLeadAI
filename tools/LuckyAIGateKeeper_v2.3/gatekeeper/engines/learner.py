from typing import Any, Dict, List
from gatekeeper.engines.journal import read_all


def _overlap(a: List[str], b: List[str]) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb)


def learn_adjustment(existing_components: List[str], path: str = "gatekeeper/data/journal.jsonl") -> Dict[str, Any]:
    """
    Closes the loop the v1 architecture doc describes ("future versions can
    feed prior journal results back into routing") but never implemented.

    Looks at past journal records whose existing_components overlap with the
    current claim's, and returns a small, bounded confidence nudge plus a
    plain-language note — never a silent override of the current assessment.
    """
    records = read_all(path)
    similar = []
    for r in records:
        a = r.get("assessment", {})
        comp = a.get("existing_components", [])
        score = _overlap(existing_components, comp)
        if score > 0:
            similar.append((score, a, r.get("audit", {})))

    if not similar:
        return {
            "similar_count": 0,
            "confidence_delta": 0.0,
            "note": "No prior journal history overlaps this claim's components.",
        }

    similar.sort(key=lambda t: t[0], reverse=True)
    top = similar[:5]
    audit_failures = sum(1 for _, _, audit in top if not audit.get("pass", True))
    avg_conf = sum(a.get("confidence", 0.0) for _, a, _ in top) / len(top)

    delta = 0.0
    note_parts = [f"{len(top)} similar prior assessment(s) found (top overlap {top[0][0]:.2f})."]
    if audit_failures:
        delta -= 0.1 * audit_failures
        note_parts.append(f"{audit_failures} of them failed audit previously — lowering confidence.")
    if avg_conf > 0.7 and not audit_failures:
        delta += 0.05
        note_parts.append("Prior similar claims were consistently high-confidence and clean.")

    delta = max(-0.3, min(0.2, delta))
    return {
        "similar_count": len(top),
        "confidence_delta": round(delta, 3),
        "note": " ".join(note_parts),
    }
