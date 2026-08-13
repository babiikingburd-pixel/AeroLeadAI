import os
import tempfile
from gatekeeper.investigation.planner import InvestigationPlanner
from gatekeeper.investigation.engine import GateKeeperInvestigationEngine
from gatekeeper.investigation.adapters import Adapter


def _tmp_journal():
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    os.close(fd)
    os.remove(path)
    return path


# --- planner ---
def test_planner_detects_domain_from_claim():
    p = InvestigationPlanner()
    claim = p.parse_claim("Can this system query a database record?")
    assert claim.domain == "database"


def test_planner_produces_ordered_probe_plan_with_domain_probe():
    p = InvestigationPlanner()
    probes = p.plan("Can this environment execute Python code?")
    names = [pr.name for pr in probes]
    assert names[0] == "claim_parse"
    assert "code_runtime" in names
    assert names[-1] == "failure_boundary"


def test_planner_reasoning_domain_has_no_domain_specific_probe():
    p = InvestigationPlanner()
    probes = p.plan("Can this system reason about a plan?")
    names = [pr.name for pr in probes]
    assert not any(n.endswith("_runtime") for n in names)


# --- engine: real code domain, end to end ---
def test_investigate_code_claim_is_real_now_and_reproducible():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    result = engine.investigate("Can this environment execute Python code?", persist=False)
    assert result.decision == "REAL-NOW"
    assert result.reproducibility == 1.0
    assert any(pr.probe.name == "code_runtime" and pr.ok for pr in result.probes)


# --- engine: real database domain ---
def test_investigate_database_claim_real_sqlite_roundtrip():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    result = engine.investigate("Can this system query a database table?", persist=False)
    db_probe = next(pr for pr in result.probes if pr.probe.name == "database_runtime")
    assert db_probe.ok is True
    assert result.decision in ("REAL-NOW", "BUILDABLE-NOW")


# --- engine: real web domain, live network ---
def test_investigate_web_claim_real_http_fetch():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)

    # Override args so the live_web probe targets an allow-listed domain
    original_plan = engine.planner.plan
    def patched_plan(claim_text):
        probes = original_plan(claim_text)
        for pr in probes:
            if pr.name == "live_web":
                pr.args["url"] = "https://pypi.org"
        return probes
    engine.planner.plan = patched_plan

    result = engine.investigate("Can this system research something on the web?", persist=False)
    web_probe = next(pr for pr in result.probes if pr.probe.name == "live_web")
    assert web_probe.ok is True
    assert web_probe.output["status"] == 200


# --- engine: browser domain, honest INTEGRATION-LIMITED ---
def test_investigate_browser_claim_is_integration_limited_not_fake_success():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    result = engine.investigate("Can this system navigate a website in a browser?", persist=False)
    browser_probe = next(pr for pr in result.probes if pr.probe.name == "browser_runtime")
    assert browser_probe.ok is False
    assert result.decision == "INTEGRATION-LIMITED"
    assert any("runtime/adapter" in a for a in result.next_actions)


# --- engine: transient retry behavior ---
def test_transient_failure_retries_then_succeeds():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    calls = {"n": 0}

    class FlakyWebAdapter(Adapter):
        name = "web"

        def execute(self, action, args):
            calls["n"] += 1
            if calls["n"] < 2:
                return {"ok": False, "error": "temporarily unavailable, try again", "transient": True}
            return {"ok": True, "output": {"status": 200}}

    engine.register_adapter("web", FlakyWebAdapter())
    result = engine.investigate("Can this system browse the web to research something?", persist=False)
    web_probe = next(pr for pr in result.probes if pr.probe.name == "live_web")
    assert web_probe.ok is True
    assert calls["n"] == 2  # failed once (transient), retried, succeeded


# --- engine: permanent failure does not retry pointlessly ---
def test_permanent_failure_does_not_retry_forever():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    calls = {"n": 0}

    class BrokenCodeAdapter(Adapter):
        name = "code"

        def execute(self, action, args):
            calls["n"] += 1
            return {"ok": False, "error": "401 unauthorized", "transient": False}

    engine.register_adapter("code", BrokenCodeAdapter())
    result = engine.investigate("Can this environment execute code?", persist=False)
    code_probe = next(pr for pr in result.probes if pr.probe.name == "code_runtime")
    assert code_probe.ok is False
    assert calls["n"] == 1  # no retry benefit for a permanent failure


# --- engine: web claim must be recognized as a domain probe (regression: 'live_web' name doesn't end in '_runtime') ---
def test_investigate_web_claim_decision_uses_live_web_as_domain_probe():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    result = engine.investigate("Can this system research something on the web?", persist=False)
    assert result.decision in ("REAL-NOW", "BUILDABLE-NOW")
    assert not any("No domain-specific runtime probe was planned" in a for a in result.next_actions)


def test_provenance_graph_populated_from_investigation():
    journal = _tmp_journal()
    engine = GateKeeperInvestigationEngine(journal_path=journal)
    engine.investigate("Can this environment execute Python code?", persist=False)
    assert len(engine.provenance.nodes) > 0
    assert len(engine.provenance.edges) > 0
