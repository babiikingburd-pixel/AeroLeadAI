from typing import Dict, Any

def audit(assessment: Dict[str, Any]) -> Dict[str, Any]:
    issues = []
    c = assessment.get("classification")
    ev = assessment.get("evidence", [])
    if c == "REAL-NOW" and not any(e.get("verified") for e in ev):
        issues.append("REAL-NOW classification has no verified evidence")
    if c == "SIMULATED" and any(e.get("verified") for e in ev):
        issues.append("SIMULATED classification conflicts with verified evidence")
    return {"pass": not issues, "issues": issues}
