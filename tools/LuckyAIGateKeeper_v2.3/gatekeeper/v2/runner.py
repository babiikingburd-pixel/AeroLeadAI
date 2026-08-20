"""Adapter-aware autonomous probe runner."""
import time
from typing import Any, Dict, List, Tuple
from gatekeeper.models import Evidence
from gatekeeper.engines.provenance import ProvenanceGraph
from .probes import PlannedProbe

class V2Runner:
    def __init__(self, adapters: Dict[str, Any], provenance: ProvenanceGraph):
        self.adapters = adapters
        self.provenance = provenance

    def run(self, probe: PlannedProbe) -> Tuple[Dict[str, Any], List[Evidence]]:
        adapter = self.adapters.get(probe.capability)
        if adapter is None:
            e = Evidence(probe.purpose, "registry", kind="failure", confidence=.90, verified=False, notes="No adapter registered")
            self.provenance.add_node(e.id, "evidence", claim=e.claim, source=e.source)
            return {"ok": False, "status": "MISSING_ADAPTER", "error": "No adapter registered"}, [e]
        outcomes=[]
        evidence=[]
        for attempt in range(1, probe.retries + 2):
            start=time.monotonic()
            try:
                result=self._dispatch(adapter, probe)
            except Exception as exc:
                result={"success":False,"error":f"{type(exc).__name__}: {exc}"}
            duration=time.monotonic()-start
            ok=bool(result.get("success", result.get("executed", False)))
            kind = "observation" if ok else ("diagnostic_failure" if probe.name.endswith(":error") or probe.name.endswith(":timeout") or probe.name == "failure_boundary" else "failure")
            ev=Evidence(probe.purpose, f"adapter:{probe.capability}", kind=kind, confidence=.90 if ok else .70, verified=ok, notes=f"attempt={attempt}; duration={duration:.3f}s")
            self.provenance.add_node(ev.id,"evidence",claim=ev.claim,source=ev.source,verified=ev.verified)
            evidence.append(ev); outcomes.append(result)
            if ok: return {"ok":True,"status":"PASS","attempt":attempt,"result":result}, evidence
            if not self._transient(result): return {"ok":False,"status":self._failure_status(result),"attempt":attempt,"result":result}, evidence
            if attempt <= probe.retries: time.sleep(min(2 ** (attempt-1), 4))
        return {"ok":False,"status":"TRANSIENT-FAILURE","attempt":len(outcomes),"result":outcomes[-1]}, evidence

    def _dispatch(self, adapter, probe):
        a=probe.action
        args=probe.args or {}
        if probe.capability=="web_research":
            url=args.get("url")
            if a in {"retrieve","freshness","cross_check","contradiction"}: return adapter.fetch(url or "https://example.com/")
        if probe.capability=="browser":
            if a=="navigate": return adapter.navigate(args.get("url","https://example.com"))
            return adapter.capability_status()
        if probe.capability=="code_execution":
            if a in {"execute","repeat"}: return adapter.run_python(args.get("code","print(2+2)"))
            if a=="error": return adapter.run_python("raise ValueError('gatekeeper-probe')")
            if a=="timeout": return adapter.run_python("import time; time.sleep(2)")
        if probe.capability=="database":
            if a=="connect": return adapter.execute("SELECT 1")
            if a=="query": return adapter.execute("SELECT 1 AS gatekeeper")
            if a=="mutate": return adapter.execute("CREATE TABLE IF NOT EXISTS gatekeeper_probe (id INTEGER)")
            if a=="verify": return adapter.execute("SELECT name FROM sqlite_master WHERE name='gatekeeper_probe'")
        if probe.capability=="vision":
            if a=="open": return adapter.image_metadata(args.get("path",""))
            if a in {"describe","localize","compare"}: return adapter.describe_content(args.get("path",""))
        if probe.capability=="reasoning":
            if a=="parse_claim": return {"success": bool(args.get("claim")), "parsed": args.get("claim")}
            if a=="failure_boundary": return {"success":True,"categories":["transient","authorization","missing_runtime","unsupported","environment"]}
            return {"success":True,"result":"reasoning probe completed"}
        return {"success":False,"error":f"Unsupported probe action: {a}"}

    @staticmethod
    def _transient(result):
        text=str(result.get("error","")).lower()
        return any(x in text for x in ["timeout","temporarily","try again","rate limit","429","503","connection","unavailable"])

    @staticmethod
    def _failure_status(result):
        text=str(result.get("error","")).lower()
        if "not attached" in text or "not implemented" in text or "disabled" in text or "runtime unavailable" in text: return "RUNTIME-NOT-ATTACHED"
        if "403" in text or "401" in text or "forbidden" in text: return "AUTHORIZATION-GAP"
        if "404" in text or "not found" in text: return "RESOURCE-GAP"
        return "STRUCTURAL-FAILURE"
