from typing import Any, Dict, List
from gatekeeper.engines.auditor import audit as audit_v1


def audit_v2(assessment: Dict[str, Any], negation_flags: List[str] = None) -> Dict[str, Any]:
    """
    Runs the original two v1 checks first (untouched), then layers on
    additional contradiction checks the v1 auditor doesn't cover.
    """
    negation_flags = negation_flags or []
    base = audit_v1(assessment)
    issues = list(base["issues"])

    c = assessment.get("classification")
    conf = assessment.get("confidence", 0.0)
    existing = assessment.get("existing_components", [])
    ev = assessment.get("evidence", [])

    if c == "FUTURE-INFRASTRUCTURE" and existing and "scientific_gap" not in negation_flags and "future_gap" not in negation_flags:
        issues.append(
            "FUTURE-INFRASTRUCTURE claimed but existing components were found and no "
            "scientific/future-infrastructure phrase was detected — decompose further "
            "before accepting this as a hard ceiling."
        )

    if c == "BUILDABLE-NOW" and any(f in negation_flags for f in ("access_gap", "authorization_gap", "legal_gap")):
        issues.append(
            "BUILDABLE-NOW claimed but the claim text contains an access/authorization/"
            "legal gap phrase — likely INTEGRATION-LIMITED instead."
        )

    if conf >= 0.85 and len(ev) == 0 and c not in ("UNKNOWN", "FUTURE-INFRASTRUCTURE"):
        issues.append(
            f"Confidence {conf} is high for a classification of {c} with zero evidence items."
        )

    return {"pass": not issues, "issues": issues}
