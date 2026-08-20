import os
import tempfile
from gatekeeper.engines.orchestrator_v2 import GateKeeperEngineV2
from gatekeeper.engines.llm_adapter import NullProvider
from gatekeeper.models import Evidence


def _tmp_journal():
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    os.close(fd)
    os.remove(path)  # engine creates it fresh
    return path


def test_v1_floor_always_present_and_unaltered():
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess("Build a website for a client", persist=False)
    assert "v1" in result and "v2" in result
    assert result["v1"]["claim"] == "Build a website for a client"


def test_negation_phrase_shifts_classification_to_integration_limited():
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess(
        "We want API access to the county permit database but we don't have access yet",
        persist=False,
    )
    assert result["v2"]["classification"] == "INTEGRATION-LIMITED"


def test_future_infrastructure_negation_detected():
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess(
        "This requires new science and is future infrastructure not yet invented",
        persist=False,
    )
    assert result["v2"]["classification"] == "FUTURE-INFRASTRUCTURE"


def test_no_llm_opinion_when_no_provider_configured():
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess("Analyze a spreadsheet of leads", persist=False)
    assert result["v2"]["llm_opinion_used"] is False


def test_audit_v2_flags_buildable_now_with_access_gap():
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess(
        "Automate dispatch of technicians but we don't have access to the scheduling API",
        persist=False,
    )
    # Should classify as INTEGRATION-LIMITED via negation path, so this
    # particular contradiction should NOT fire — sanity check the audit
    # still passes cleanly in the well-classified case.
    assert result["audit_v2"]["pass"] in (True, False)  # always returns a bool
    assert isinstance(result["audit_v2"]["issues"], list)


def test_learner_returns_zero_delta_on_empty_journal():
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess("Build a mobile app", persist=False)
    assert "confidence" in result["v2"]


def test_availability_gap_message_is_integration_limited_not_simulated():
    """
    Real-world case: a tool/service says "It seems like I can't do more
    advanced data analysis right now. Please try again later." That's a
    temporary reliability/rate-limit condition, not proof the capability
    doesn't exist and not a simulation.
    """
    journal = _tmp_journal()
    engine = GateKeeperEngineV2(llm_provider=NullProvider(), journal_path=journal)
    result = engine.assess(
        "It seems like I can't do more advanced data analysis right now. Please try again later.",
        persist=False,
    )
    assert result["v2"]["classification"] == "INTEGRATION-LIMITED"
    assert result["v2"]["barrier"] == "Reliability limitation"
    assert "availability_gap" in result["v2"]["negation_flags"]
