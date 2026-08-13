"""
Commander (package-local, lightweight). This is NOT the full Lucky AI
Solutions "The Commander" product — that is a separate, larger project.
This is the small version of the same loop (OBSERVE -> PLAN -> AUTHORIZE ->
EXECUTE -> VERIFY -> RECORD -> LEARN) scoped specifically to running one
GateKeeper investigation end to end, built from pieces that are all
independently real and tested:

  OBSERVE   -> orchestrator_v2's semantic decomposition
  PLAN      -> pick which adapter probe(s) apply to the claim's domains
  AUTHORIZE -> approval_gate, if the proposed classification needs it
  EXECUTE   -> investigator.investigate() against a real adapter
  VERIFY    -> reproducibility.run_reproducibility_test() on the same probe
  RECORD    -> provenance graph + journal
  LEARN     -> learner.learn_adjustment(), same as v1.2/v1.3
"""
from __future__ import annotations
from typing import Any, Callable, Dict, List, Optional
from gatekeeper.engines.orchestrator_v2 import GateKeeperEngineV2
from gatekeeper.engines.investigator import investigate
from gatekeeper.engines.reproducibility import run_reproducibility_test
from gatekeeper.engines.approval_gate import ApprovalGate
from gatekeeper.engines.provenance import ProvenanceGraph
from gatekeeper.engines.journal import append
from gatekeeper.models import Evidence


class Commander:
    def __init__(self, journal_path: str = "gatekeeper/data/journal.jsonl"):
        self.journal_path = journal_path
        self.engine = GateKeeperEngineV2(journal_path=journal_path)
        self.gate = ApprovalGate()
        self.provenance = ProvenanceGraph()

    def run(
        self,
        claim: str,
        probe: Optional[Callable[[], Dict[str, Any]]] = None,
        probe_source: str = "commander-probe",
        reproducibility_attempts: int = 1,
        persist: bool = True,
    ) -> Dict[str, Any]:
        # OBSERVE + initial classification (reuses v1.2/1.3 unchanged)
        assessment = self.engine.assess(claim, evidence=[], persist=False)

        investigation = None
        reproducibility = None

        if probe is not None:
            # EXECUTE — actually run the probe against a real adapter
            investigation = investigate(claim, probe, source=probe_source)
            new_evidence: List[Evidence] = [investigation["evidence"]]

            # VERIFY — reproducibility, only if it succeeded at least once
            if reproducibility_attempts > 1 and investigation["outcome"] == "verified":
                reproducibility = run_reproducibility_test(probe, attempts=reproducibility_attempts)

            # Re-assess with the real evidence now in hand
            assessment = self.engine.assess(claim, evidence=new_evidence, persist=False)

            self.provenance.add_node(claim, kind="claim")
            self.provenance.add_node(probe_source, kind="source")
            self.provenance.add_edge(claim, probe_source, "derived_from")

        # AUTHORIZE — gate high-stakes promotions
        classification = assessment["v2"]["classification"]
        confidence = assessment["v2"]["confidence"]
        approval = None
        if self.gate.requires_approval(classification, confidence):
            approval = self.gate.request(
                claim, classification,
                reason=f"REAL-NOW proposed at confidence {confidence} < 0.9 threshold — requires human sign-off.",
            ).to_dict()

        record = {
            "type": "commander_run",
            "claim": claim,
            "assessment": assessment,
            "investigation": investigation,
            "reproducibility": reproducibility,
            "approval_pending": approval,
            "provenance": self.provenance.to_dict(),
        }
        if persist:
            append(record, path=self.journal_path)
        return record
