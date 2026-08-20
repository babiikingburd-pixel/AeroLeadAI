import os
import shutil
import tempfile
from gatekeeper.harness.session_harness import SessionHarness


def _tmp_dir():
    return tempfile.mkdtemp(prefix="gk_harness_test_")


def test_scan_capabilities_reflects_real_environment():
    d = _tmp_dir()
    h = SessionHarness(agent_name="Claude", memory_dir=d)
    profile = h.scan_capabilities()
    # code/database/web/vision-metadata/reasoning/execution are genuinely
    # real in this environment; browser genuinely is not.
    assert profile["code"]["available"] is True
    assert profile["database"]["available"] is True
    assert profile["web"]["available"] is True
    assert profile["reasoning"]["available"] is True
    assert profile["execution"]["available"] is True
    assert profile["browser"]["available"] is False
    shutil.rmtree(d)


def test_first_attach_has_no_prior_drift():
    d = _tmp_dir()
    h = SessionHarness(agent_name="Claude", memory_dir=d)
    report = h.attach()
    assert report["drift_report"]["note"] == ["no prior scan to compare against"]
    shutil.rmtree(d)


def test_drift_detected_when_capability_status_changes_between_sessions():
    d = _tmp_dir()

    with SessionHarness(agent_name="Claude", memory_dir=d) as h1:
        pass  # writes v1.1 with real profile (browser unavailable)

    h2 = SessionHarness(agent_name="Claude", memory_dir=d)
    # Simulate a capability that was unavailable before now becoming available
    h2.scan_capabilities()
    h2.capability_profile["browser"] = {"available": True, "detail": "ok"}
    drift = h2.detect_drift(h2.capability_profile)
    assert "browser" in drift["newly_available"]
    shutil.rmtree(d)


def test_feed_reasoning_uses_manual_opinion_provider_no_api_key():
    d = _tmp_dir()
    h = SessionHarness(agent_name="Claude", memory_dir=d)
    result = h.feed_reasoning(
        claim="AeroLeadAI can cross-reference storm imagery with permit records",
        classification="INTEGRATION-LIMITED",
        barrier="API/access limitation",
        confidence=0.7,
        rationale=["live reasoning supplied directly by the attached agent"],
    )
    assert result["v2"]["classification"] == "INTEGRATION-LIMITED"
    assert result["v2"]["llm_opinion_used"] is True
    assert result["v2"]["llm_provider"] == "ManualOpinionProvider"
    assert len(h.feed_log) == 1
    shutil.rmtree(d)


def test_context_manager_writes_versioned_snapshot_with_full_session():
    d = _tmp_dir()
    with SessionHarness(agent_name="Claude", memory_dir=d) as h:
        h.feed_reasoning("test claim", "BUILDABLE-NOW", confidence=0.6)
    assert h.written_snapshot_path is not None
    assert h.written_snapshot_path.endswith("_v1.1.zip")

    import zipfile, json
    with zipfile.ZipFile(h.written_snapshot_path) as zf:
        session = json.loads(zf.read("session_current.json"))
    assert session["type"] == "session_harness"
    assert session["capability_profile"]["code"]["available"] is True
    assert len(session["feed_log"]) == 1
    shutil.rmtree(d)


def test_two_sessions_never_overwrite_and_history_grows():
    d = _tmp_dir()
    with SessionHarness(agent_name="Claude", memory_dir=d) as h1:
        h1.feed_reasoning("claim one", "REAL-NOW", confidence=0.9)
    with SessionHarness(agent_name="Claude", memory_dir=d) as h2:
        h2.feed_reasoning("claim two", "UNKNOWN", confidence=0.4)
    assert h1.written_snapshot_path.endswith("_v1.1.zip")
    assert h2.written_snapshot_path.endswith("_v1.2.zip")
    assert os.path.exists(h1.written_snapshot_path)
    assert os.path.exists(h2.written_snapshot_path)
    shutil.rmtree(d)
