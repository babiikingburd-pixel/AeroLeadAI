"""Decision policy. Hard safety rules live here, not in prompts."""
from typing import Dict, List

def decide(score: float, confidence: float, reproducibility: float, contradiction: bool, runtime_gap: bool, risk: str) -> str:
    if runtime_gap:
        return "INFRASTRUCTURE-GAP"
    if contradiction:
        return "CONTRADICTED"
    if score >= .85 and confidence >= .80 and reproducibility >= .67:
        return "REAL-NOW" if risk != "high" or confidence >= .95 else "REAL-NOW-PENDING-APPROVAL"
    if score >= .50:
        return "PARTIAL"
    return "NOT-DEMONSTRATED"

def required_next_actions(decision: str, failures: List[str]) -> List[str]:
    actions = []
    if decision == "INFRASTRUCTURE-GAP": actions.append("Attach the missing operational runtime/connector and rerun the same probes.")
    if decision == "CONTRADICTED": actions.append("Run an independent counter-test and reconcile the contradictory evidence.")
    if decision in {"PARTIAL", "NOT-DEMONSTRATED"}: actions.append("Strengthen the smallest failed experiment rather than changing the claim.")
    actions.extend([f"Investigate failed probe: {x}" for x in failures[:5]])
    return actions
