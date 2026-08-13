from gatekeeper.engines.orchestrator import GateKeeperEngine
from gatekeeper.models import Evidence

def test_unverified_simulation_is_not_real():
    a = GateKeeperEngine().assess("build an autonomous research agent", [Evidence("prototype works", "local", "simulation", .9, False)], persist=False)
    assert a.classification.value == "SIMULATED"

def test_verified_capability_can_be_real():
    a = GateKeeperEngine().assess("analyze a real document", [Evidence("output reproduced", "test-run", "observation", .95, True)], persist=False)
    assert a.classification.value == "REAL-NOW"
