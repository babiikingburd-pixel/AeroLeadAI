"""
GateKeeperInvestigationEngine — the controller that actually runs the loop:

  CLAIM -> DECOMPOSE -> PLAN -> SELECT MACHINERY -> EXECUTE -> RETRY ->
  COLLECT EVIDENCE -> VERIFY -> CONTRADICT -> SCORE -> DECIDE -> LEARN

This is additive: it does not modify gatekeeper/models.py, gatekeeper/
engines/orchestrator*.py, or any v1.1-v1.5 file. It reuses the existing
ProvenanceGraph (gatekeeper/engines/provenance.py) so evidence collected
here links into the same provenance model already shipped in v1.4, and
writes to the same journal used everywhere else in the package.
"""
from __future__ import annotations
import time
import uuid
from typing import Any, Dict, List

from gatekeeper.investigation.models import Probe, ProbeEvidence, ProbeResult, InvestigationResult
from gatekeeper.investigation.planner import InvestigationPlanner
from gatekeeper.investigation.adapters import (
    Adapter, ReasoningAdapter, DiagnosticsAdapter, ExecutionAdapter,
    WebAdapter, CodeAdapter, DatabaseAdapterProbe, VisionAdapterProbe, BrowserAdapter,
)
from gatekeeper.engines.provenance import ProvenanceGraph
from gatekeeper.engines.journal import append as journal_append

_DOMAIN_PROBE_NAMES = {"live_web", "browser_runtime", "vision_runtime", "code_runtime", "database_runtime"}
_TRANSIENT_MARKERS = ["timeout", "temporarily", "try again", "rate limit", "429", "503", "unreachable", "unavailable"]
_PERMANENT_MARKERS = ["not found", "404", "unauthorized", "401", "forbidden", "403", "not attached", "not implemented"]


def _classify_failure(message: str) -> str:
    text = (message or "").lower()
    if any(m in text for m in _PERMANENT_MARKERS):
        return "permanent"
    if any(m in text for m in _TRANSIENT_MARKERS):
        return "transient"
    return "unknown"


class GateKeeperInvestigationEngine:
    def __init__(self, journal_path: str = "gatekeeper/data/journal.jsonl"):
        self.planner = InvestigationPlanner()
        self.provenance = ProvenanceGraph()
        self.journal_path = journal_path
        self.adapters: Dict[str, Adapter] = {
            "reasoning": ReasoningAdapter(),
            "diagnostics": DiagnosticsAdapter(),
            "execution": ExecutionAdapter(),
            "web": WebAdapter(),
            "code": CodeAdapter(),
            "database": DatabaseAdapterProbe(),
            "vision": VisionAdapterProbe(),
            "browser": BrowserAdapter(),
        }

    def register_adapter(self, capability: str, adapter: Adapter) -> None:
        self.adapters[capability] = adapter

    def _make_evidence(self, probe: Probe, result: Dict[str, Any], attempt: int) -> ProbeEvidence:
        ok = bool(result.get("ok"))
        return ProbeEvidence(
            kind="probe_result",
            claim=probe.args.get("claim", probe.name),
            value=result.get("output"),
            confidence=0.9 if ok else 0.3,
            source=probe.capability,
            verified=ok,
            metadata={"probe": probe.name, "attempt": attempt, "error": result.get("error")},
        )

    def execute_probe(self, probe: Probe) -> ProbeResult:
        adapter = self.adapters.get(probe.capability)
        if adapter is None:
            return ProbeResult(probe=probe, ok=False, error=f"No adapter registered for {probe.capability}", status="MISSING_ADAPTER")

        last_result: Dict[str, Any] = {}
        for attempt in range(1, probe.retries + 2):
            started = time.monotonic()
            try:
                result = adapter.execute(probe.action, probe.args)
            except Exception as exc:  # noqa: BLE001
                result = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "transient": False}
            duration = time.monotonic() - started
            last_result = result

            evidence = self._make_evidence(probe, result, attempt)
            ev_dict = {k: v for k, v in evidence.to_dict().items() if k not in ("id", "kind")}
            self.provenance.add_node(evidence.id, kind="evidence", **ev_dict)
            self.provenance.add_edge(probe.name, evidence.id, "derived_from")

            if result.get("ok"):
                return ProbeResult(
                    probe=probe, ok=True, output=result.get("output"), duration_s=duration,
                    evidence=[evidence], attempt=attempt, status="SUCCESS",
                )

            failure_kind = _classify_failure(str(result.get("error", "")))
            if failure_kind != "transient" or attempt == probe.retries + 1:
                return ProbeResult(
                    probe=probe, ok=False, error=result.get("error"), transient=(failure_kind == "transient"),
                    duration_s=duration, evidence=[evidence], attempt=attempt,
                    status="TRANSIENT_FAILURE" if failure_kind == "transient" else "PERMANENT_FAILURE",
                )
            # transient and retries remain — loop again

        return ProbeResult(probe=probe, ok=False, error=last_result.get("error"), status="EXHAUSTED_RETRIES", attempt=probe.retries + 1)

    def _contradictions(self, probe_results: List[ProbeResult]) -> List[str]:
        """
        Only flags a genuine disagreement between two pieces of evidence —
        e.g. a probe reporting a capability as implemented while another
        piece of verified evidence disproves it. Deliberately does NOT
        treat "the generic minimal_execution demo succeeded while the
        domain-specific runtime probe honestly reported not-attached" as a
        contradiction — that is the expected, honest INTEGRATION-LIMITED
        case, not evidence of a faked result. An earlier version of this
        check conflated the two and mislabeled every not-attached adapter
        as SIMULATED; fixed after catching it in this session's own tests.
        """
        issues = []
        for pr in probe_results:
            if pr.ok and isinstance(pr.output, dict) and pr.output.get("implemented") is False:
                issues.append(
                    f"Probe '{pr.probe.name}' reported ok=True but its own output says "
                    f"implemented=False for {pr.probe.capability} — inconsistent result."
                )
        return issues

    def _score(self, probe_results: List[ProbeResult]) -> Dict[str, float]:
        required = [pr for pr in probe_results if pr.probe.required]
        if not required:
            return {"score": 0.0, "confidence": 0.0, "reproducibility": 0.0}
        success_rate = sum(1 for pr in required if pr.ok) / len(required)
        repeat = next((pr for pr in probe_results if pr.probe.name == "repeatability"), None)
        reproducibility = 1.0 if (repeat and repeat.ok) else 0.0
        confidence = round(min(1.0, 0.3 + 0.5 * success_rate + 0.2 * reproducibility), 3)
        return {"score": round(success_rate, 3), "confidence": confidence, "reproducibility": reproducibility}

    def _decide(self, claim_domain_probe: ProbeResult | None, minimal: ProbeResult | None, contradictions: List[str], score: Dict[str, float]) -> tuple[str, List[str]]:
        next_actions: List[str] = []
        if contradictions:
            return "SIMULATED", ["Resolve contradiction before trusting this claim.", *contradictions]

        if claim_domain_probe is None:
            if minimal and minimal.ok:
                return "BUILDABLE-NOW", ["No domain-specific runtime probe was planned; only a generic demonstration ran."]
            return "UNKNOWN", ["Insufficient probes ran to reach a classification."]

        if claim_domain_probe.ok:
            return ("REAL-NOW" if score["reproducibility"] >= 1.0 else "BUILDABLE-NOW"), (
                [] if score["reproducibility"] >= 1.0 else ["Re-run to confirm reproducibility before treating as REAL-NOW."]
            )

        kind = _classify_failure(str(claim_domain_probe.error or ""))
        if kind == "transient":
            next_actions.append("Retry later — failure looked temporary (rate-limited/unreachable), not structural.")
            return "INTEGRATION-LIMITED", next_actions
        if "not attached" in str(claim_domain_probe.error or "").lower() or "not implemented" in str(claim_domain_probe.error or "").lower():
            next_actions.append(f"Attach a real {claim_domain_probe.probe.capability} runtime/adapter to move this past INTEGRATION-LIMITED.")
            return "INTEGRATION-LIMITED", next_actions
        return "UNKNOWN", ["Failure did not match a known transient or attachment-gap pattern — needs manual review."]

    def investigate(self, claim_text: str, persist: bool = True) -> InvestigationResult:
        probes = self.planner.plan(claim_text)
        results: List[ProbeResult] = [self.execute_probe(p) for p in probes]

        evidence: List[ProbeEvidence] = [e for pr in results for e in pr.evidence]
        contradictions = self._contradictions(results)
        score = self._score(results)

        minimal = next((pr for pr in results if pr.probe.name == "minimal_execution"), None)
        domain_probe = next((pr for pr in results if pr.probe.name in _DOMAIN_PROBE_NAMES), None)
        decision, next_actions = self._decide(domain_probe, minimal, contradictions, score)

        result = InvestigationResult(
            investigation_id=str(uuid.uuid4()),
            claim=claim_text,
            status="complete",
            score=score["score"],
            confidence=score["confidence"],
            reproducibility=score["reproducibility"],
            probes=results,
            evidence=evidence,
            contradictions=contradictions,
            decision=decision,
            next_actions=next_actions,
        )

        if persist:
            journal_append({"type": "investigation_v6", "result": result.to_dict(), "provenance": self.provenance.to_dict()}, path=self.journal_path)

        return result
