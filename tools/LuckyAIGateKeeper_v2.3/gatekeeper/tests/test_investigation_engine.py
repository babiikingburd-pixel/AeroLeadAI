import os
import tempfile
from gatekeeper.engines.provenance import ProvenanceGraph
from gatekeeper.engines.reproducibility import run_reproducibility_test
from gatekeeper.engines.approval_gate import ApprovalGate
from gatekeeper.engines.investigator import investigate
from gatekeeper.engines.commander import Commander
from gatekeeper.adapters.code_execution import CodeExecutionAdapter
from gatekeeper.adapters.database import DatabaseAdapter
from gatekeeper.adapters.web_research import WebResearchAdapter
from gatekeeper.adapters.vision import VisionAdapter
from gatekeeper.adapters.browser import BrowserAdapter


def _tmp_journal():
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    os.close(fd)
    os.remove(path)
    return path


# --- provenance ---
def test_provenance_tracks_chain():
    g = ProvenanceGraph()
    g.add_node("claimA", kind="claim")
    g.add_node("evidence1", kind="evidence")
    g.add_edge("claimA", "evidence1", "derived_from")
    chain = g.chain("claimA")
    assert len(chain) == 1
    assert chain[0]["dst"] == "evidence1"


# --- reproducibility ---
def test_reproducibility_detects_consistent_success():
    report = run_reproducibility_test(lambda: 42, attempts=3)
    assert report["reproducible"] is True
    assert report["success_count"] == 3


def test_reproducibility_detects_flaky_result():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return "ok"

    report = run_reproducibility_test(flaky, attempts=3)
    assert report["reproducible"] is False
    assert report["failure_count"] == 1


# --- approval gate ---
def test_approval_gate_requires_approval_below_threshold():
    gate = ApprovalGate()
    assert gate.requires_approval("REAL-NOW", 0.5) is True
    assert gate.requires_approval("REAL-NOW", 0.95) is False
    assert gate.requires_approval("BUILDABLE-NOW", 0.5) is False


def test_approval_gate_decide():
    gate = ApprovalGate()
    req = gate.request("claim", "REAL-NOW", "low confidence")
    decided = gate.decide(req.id, approved=True, decided_by="lucky", note="looks right")
    assert decided.status == "approved"
    assert gate.get(req.id).status == "approved"


# --- real code execution adapter ---
def test_code_execution_adapter_runs_real_subprocess():
    adapter = CodeExecutionAdapter()
    result = adapter.run_python("print(2 + 2)")
    assert result["executed"] is True
    assert result["success"] is True
    assert result["stdout"].strip() == "4"


def test_code_execution_adapter_reports_real_failure():
    adapter = CodeExecutionAdapter()
    result = adapter.run_python("raise ValueError('nope')")
    assert result["success"] is False
    assert "ValueError" in result["stderr"]


# --- real database adapter ---
def test_database_adapter_real_sqlite_roundtrip():
    adapter = DatabaseAdapter(":memory:")
    adapter.execute("CREATE TABLE leads (id INTEGER PRIMARY KEY, address TEXT)")
    adapter.execute("INSERT INTO leads (address) VALUES (?)", ("123 Main St",))
    result = adapter.execute("SELECT * FROM leads")
    assert result["success"] is True
    assert result["row_count"] == 1
    assert result["rows"][0][1] == "123 Main St"
    adapter.close()


# --- vision adapter (real PIL) ---
def test_vision_adapter_reads_real_image_metadata():
    from PIL import Image
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    Image.new("RGB", (10, 20), color="red").save(path)
    adapter = VisionAdapter()
    result = adapter.image_metadata(path)
    os.remove(path)
    assert result["success"] is True
    assert result["size"] == (10, 20)


def test_vision_adapter_honest_about_content_description():
    adapter = VisionAdapter()
    result = adapter.describe_content("does-not-matter.png")
    assert result["implemented"] is False
    assert result["success"] is False


# --- browser adapter (honest stub) ---
def test_browser_adapter_honest_stub():
    adapter = BrowserAdapter()
    result = adapter.navigate("https://example.com")
    assert result["implemented"] is False


# --- investigator: transient vs permanent classification ---
def test_investigator_marks_success_verified():
    result = investigate("claim", lambda: {"success": True}, source="test")
    assert result["outcome"] == "verified"
    assert result["evidence"].verified is True


def test_investigator_classifies_transient_and_retries():
    calls = {"n": 0}

    def probe():
        calls["n"] += 1
        if calls["n"] < 3:
            return {"success": False, "error": "temporarily unavailable, try again"}
        return {"success": True}

    result = investigate("claim", probe, source="test", max_retries=5)
    assert result["outcome"] == "verified"
    assert calls["n"] == 3


def test_investigator_classifies_permanent_failure_no_retry_benefit():
    def probe():
        return {"success": False, "error": "403 forbidden"}

    result = investigate("claim", probe, source="test", max_retries=3)
    assert result["outcome"] == "permanent_failure"
    assert result["failure_kind"] == "permanent"
    assert len(result["attempts"]) == 1  # permanent failures don't retry


# --- Commander end-to-end with a real adapter ---
def test_commander_end_to_end_with_real_code_execution():
    journal = _tmp_journal()
    commander = Commander(journal_path=journal)
    adapter = CodeExecutionAdapter()

    def probe():
        return adapter.run_python("print('capability works')")

    record = commander.run(
        "Can this environment execute a small Python capability test?",
        probe=probe,
        probe_source="code_execution_adapter",
        persist=False,
    )
    assert record["investigation"]["outcome"] == "verified"
    assert record["assessment"]["v2"]["classification"] == "REAL-NOW"
