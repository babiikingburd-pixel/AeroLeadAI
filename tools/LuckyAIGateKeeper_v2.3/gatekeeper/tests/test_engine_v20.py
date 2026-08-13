import os, tempfile
from gatekeeper.v2.probes import infer_capabilities, build_plan
from gatekeeper.v2.engine import GateKeeper20
from gatekeeper.adapters.code_execution import CodeExecutionAdapter
from gatekeeper.adapters.database import DatabaseAdapter


def test_registry_plans_capability():
    assert "web_research" in infer_capabilities("Can this system perform live web research?")
    assert any(p.capability=="web_research" for p in build_plan("Can this system perform live web research?"))


def test_v20_real_code_path():
    engine=GateKeeper20(adapters={"reasoning": engine_reasoning(), "code_execution": CodeExecutionAdapter()})
    result=engine.investigate("Can this system execute Python code?")
    assert result["version"]=="2.0"
    assert result["decision"] in {"REAL-NOW","PARTIAL","REAL-NOW-PENDING-APPROVAL"}
    assert result["evidence_fusion"]["verified_count"] >= 1


def test_v20_database_path():
    db=DatabaseAdapter(":memory:")
    engine=GateKeeper20(adapters={"reasoning": engine_reasoning(), "database": db})
    result=engine.investigate("Can this system query a database?")
    assert result["evidence_fusion"]["verified_count"] >= 1
    db.close()


def test_missing_browser_is_gap_not_impossibility():
    engine=GateKeeper20(adapters={"reasoning": engine_reasoning()})
    result=engine.investigate("Can this system use a browser to click a form?")
    assert result["decision"]=="INFRASTRUCTURE-GAP"
    assert any("browser" in x.lower() for x in result["next_actions"])

class engine_reasoning:
    def execute(self,*a,**k): return {"success":True}
