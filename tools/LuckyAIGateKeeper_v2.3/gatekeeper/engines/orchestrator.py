from gatekeeper.models import Assessment, Evidence
from gatekeeper.engines.decomposer import decompose
from gatekeeper.engines.classifier import classify
from gatekeeper.engines.experiments import smallest_experiment
from gatekeeper.engines.evidence import normalize
from gatekeeper.engines.auditor import audit
from gatekeeper.engines.journal import append

class GateKeeperEngine:
    """Local, deterministic reality-assessment engine. No model/API required."""
    def assess(self, claim: str, evidence=None, persist=True) -> Assessment:
        evidence = normalize(evidence or [])
        parts = decompose(claim)
        c, b, confidence = classify(evidence, parts["existing_components"], parts["missing_components"], claim)
        exp = smallest_experiment(claim, parts["missing_components"], b.value)
        rationale = [f"Classification selected from {len(evidence)} evidence item(s).",
                     f"Barrier assessed as: {b.value}."]
        assessment = Assessment(claim=claim, classification=c, barrier=b, confidence=confidence,
                                rationale=rationale, existing_components=parts["existing_components"],
                                missing_components=parts["missing_components"], experiments=[exp], evidence=evidence)
        audit_result = audit(assessment.to_dict())
        record = {"type":"assessment", "assessment":assessment.to_dict(), "audit":audit_result}
        if persist: append(record)
        return assessment
