"""
SessionHarness — the piece that "attaches to the brain" of whatever AI is
actively running this package in a given session.

What that means concretely, with no metaphor left unbuilt:

1. SELF-SCAN — on attach(), it actually runs each adapter's own probe
   (real subprocess call, real sqlite roundtrip, real HTTP fetch, real
   Pillow check) rather than trusting whatever the last version claimed.
   This is "self-adapting": the harness doesn't assume code execution or
   network access work just because they did in a previous version — it
   checks, every time, in the actual environment it's running in right now.

2. DRIFT DETECTION — it compares this scan against the most recent memory
   snapshot's capability profile (if one exists) and reports what changed:
   a capability that worked before but doesn't now (or vice versa) is
   surfaced explicitly, not silently assumed to still be true.

3. THE DRIVER HOOK — feed_reasoning() is the literal attachment point: the
   AI running this harness (Claude, or any onboarded agent) can hand its
   own live conclusion about a claim straight into the GateKeeper engine,
   using the same ManualOpinionProvider mechanism proven out in v1.2 —
   no API key, no network call, because the "brain" is already present
   and doesn't need to phone itself.

4. AUTOMATIC CAPTURE — used as a context manager, attaching and detaching
   automatically writes a versioned memory snapshot (v1.5's MemoryArchiver)
   containing the capability scan, the drift report, and every
   feed_reasoning() call made during the session.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from gatekeeper.investigation.engine import GateKeeperInvestigationEngine
from gatekeeper.engines.orchestrator_v2 import GateKeeperEngineV2
from gatekeeper.engines.llm_adapter import ManualOpinionProvider
from gatekeeper.engines.memory_archive import MemoryArchiver

_CAPABILITY_PROBES = {
    "reasoning": ("reasoning", "parse_claim", {"claim": "self-scan"}),
    "execution": ("execution", "minimal_test", {"claim": "self-scan"}),
    "web": ("web", "http_probe", {"url": "https://pypi.org"}),
    "code": ("code", "capability_probe", {}),
    "database": ("database", "capability_probe", {}),
    "vision": ("vision", "capability_probe", {}),
    "browser": ("browser", "capability_probe", {}),
}


class SessionHarness:
    def __init__(
        self,
        agent_name: str,
        journal_path: str = "gatekeeper/data/journal.jsonl",
        memory_dir: str = "gatekeeper/data/memory",
    ):
        self.agent_name = agent_name
        self.journal_path = journal_path
        self.archiver = MemoryArchiver(memory_dir=memory_dir)
        self._investigation_engine = GateKeeperInvestigationEngine(journal_path=journal_path)
        self._assessment_engine = GateKeeperEngineV2(journal_path=journal_path)
        self.capability_profile: Dict[str, Any] = {}
        self.drift_report: Dict[str, List[str]] = {}
        self.feed_log: List[Dict[str, Any]] = []
        self.started_at: Optional[str] = None
        self.ended_at: Optional[str] = None
        self.written_snapshot_path: Optional[str] = None

    # ---- 1. self-scan ----
    def scan_capabilities(self) -> Dict[str, Any]:
        profile: Dict[str, Any] = {}
        for capability, (adapter_key, action, args) in _CAPABILITY_PROBES.items():
            adapter = self._investigation_engine.adapters.get(adapter_key)
            if adapter is None:
                profile[capability] = {"available": False, "detail": "no adapter registered"}
                continue
            try:
                result = adapter.execute(action, args)
                profile[capability] = {
                    "available": bool(result.get("ok")),
                    "detail": result.get("error") or "ok",
                }
            except Exception as exc:  # noqa: BLE001
                profile[capability] = {"available": False, "detail": f"{type(exc).__name__}: {exc}"}
        self.capability_profile = profile
        return profile

    # ---- 2. drift detection ----
    def _previous_profile(self) -> Optional[Dict[str, Any]]:
        latest = self.archiver.latest_version()
        if latest is None:
            return None
        snap = self.archiver.read_snapshot(latest)
        current = snap.get("session_current") or {}
        return current.get("capability_profile")

    def detect_drift(self, current_profile: Dict[str, Any]) -> Dict[str, List[str]]:
        previous = self._previous_profile()
        if previous is None:
            self.drift_report = {"newly_available": [], "newly_unavailable": [], "note": ["no prior scan to compare against"]}
            return self.drift_report

        newly_available, newly_unavailable = [], []
        for cap, current_state in current_profile.items():
            prev_state = previous.get(cap, {})
            was = bool(prev_state.get("available"))
            now = bool(current_state.get("available"))
            if now and not was:
                newly_available.append(cap)
            elif was and not now:
                newly_unavailable.append(cap)

        self.drift_report = {"newly_available": newly_available, "newly_unavailable": newly_unavailable, "note": []}
        return self.drift_report

    # ---- 3. the driver hook ----
    def feed_reasoning(
        self,
        claim: str,
        classification: str,
        barrier: str = "Unknown / insufficient evidence",
        confidence: float = 0.7,
        rationale: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        The literal attachment point. The AI running this harness supplies
        its own live conclusion; this is fed straight into GateKeeperEngineV2
        via ManualOpinionProvider — no API key, no network round trip.
        """
        opinion = {
            "classification": classification,
            "barrier": barrier,
            "confidence": confidence,
            "rationale": rationale or [],
            "_source": f"session-harness-driver:{self.agent_name}",
        }
        engine = GateKeeperEngineV2(llm_provider=ManualOpinionProvider(opinion), journal_path=self.journal_path)
        result = engine.assess(claim, evidence=[], persist=False)
        self.feed_log.append({"at": datetime.now(timezone.utc).isoformat(), "claim": claim, "opinion": opinion, "result": result})
        return result

    # ---- 4. automatic capture ----
    def attach(self) -> Dict[str, Any]:
        self.started_at = datetime.now(timezone.utc).isoformat()
        profile = self.scan_capabilities()
        drift = self.detect_drift(profile)
        return {"agent_name": self.agent_name, "capability_profile": profile, "drift_report": drift, "started_at": self.started_at}

    def detach(self) -> str:
        self.ended_at = datetime.now(timezone.utc).isoformat()
        session_record = {
            "type": "session_harness",
            "agent_name": self.agent_name,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "capability_profile": self.capability_profile,
            "drift_report": self.drift_report,
            "feed_log": self.feed_log,
        }
        self.written_snapshot_path = self.archiver.write_snapshot(session_record, journal_path=self.journal_path)
        return self.written_snapshot_path

    def __enter__(self) -> "SessionHarness":
        self.attach()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.detach()
        return False
