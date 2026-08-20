"""GateKeeper 2.0: autonomous capability investigation controller."""
from typing import Any, Dict, List, Optional
from gatekeeper.models import Evidence
from gatekeeper.engines.provenance import ProvenanceGraph
from gatekeeper.engines.journal import append
from gatekeeper.engines.approval_gate import ApprovalGate
from gatekeeper.engines.learner import learn_adjustment
from gatekeeper.adapters.code_execution import CodeExecutionAdapter
from gatekeeper.adapters.database import DatabaseAdapter
from gatekeeper.adapters.web_research import WebResearchAdapter
from gatekeeper.adapters.vision import VisionAdapter
from gatekeeper.adapters.browser import BrowserAdapter
from .probes import build_plan
from .runner import V2Runner
from .evidence_fusion import fuse
from .policy import decide, required_next_actions

class GateKeeper20:
    VERSION="2.0"
    def __init__(self, journal_path="gatekeeper/data/journal.jsonl", adapters=None):
        self.journal_path=journal_path
        self.provenance=ProvenanceGraph()
        self.approval=ApprovalGate()
        self.adapters=adapters or {
            "reasoning": _ReasoningAdapter(),
            "web_research": WebResearchAdapter(),
            "browser": BrowserAdapter(),
            "vision": VisionAdapter(),
            "code_execution": CodeExecutionAdapter(),
            "database": DatabaseAdapter(),
        }

    def investigate(self, claim: str, persist: bool=True) -> Dict[str, Any]:
        plan=build_plan(claim)
        runner=V2Runner(self.adapters,self.provenance)
        results=[]; evidence=[]
        for p in plan:
            r,e=runner.run(p); results.append({"probe":p.to_dict(),"result":r}); evidence.extend(e)
        fusion=fuse(evidence)
        required=[x for x in results if x["probe"]["required"]]
        passed=[x for x in required if x["result"]["ok"]]
        score=len(passed)/max(1,len(required))
        repeat=[x for x in results if x["probe"]["name"].endswith(":repeat") or x["probe"]["name"]=="repeatability"]
        reproducibility=1.0 if repeat and all(x["result"]["ok"] for x in repeat) else (0.67 if score>=.85 else 0.0)
        runtime_gaps=any(x["result"]["status"] in {"RUNTIME-NOT-ATTACHED","MISSING_ADAPTER"} for x in results)
        failures=[x["probe"]["name"] for x in results if not x["result"]["ok"]]
        decision=decide(score,fusion["confidence"],reproducibility,fusion["contradiction"],runtime_gaps,"medium")
        confidence=fusion["confidence"]
        if decision=="REAL-NOW" and confidence<.90:
            decision="REAL-NOW-PENDING-APPROVAL"
        learning=learn_adjustment([], path=self.journal_path)
        payload={
            "engine":"GateKeeper","version":self.VERSION,"claim":claim,
            "decision":decision,"score":round(score,3),"confidence":confidence,
            "reproducibility":round(reproducibility,3),"evidence_fusion":fusion,
            "plan":[p.to_dict() for p in plan],"results":results,
            "failures":failures,"next_actions":required_next_actions(decision,failures),
            "learning":learning,"provenance":self.provenance.to_dict(),
            "principle":"A missing runtime is an infrastructure gap, not proof of impossibility."
        }
        if persist: append({"type":"gatekeeper_v2_assessment","payload":payload},path=self.journal_path)
        return payload

class _ReasoningAdapter:
    def execute(self,*args,**kwargs): return {"success":True}
