"""
Onboarding session. REAL-NOW.

Use as a context manager around a chatbot onboarding + working session:

    with OnboardingSession(agent_name="Claude") as session:
        session.log("ran Context Alignment Report")
        session.log("assessed 3 claims")
        ...

On __exit__ (i.e. when the session ends, however it ends — normal
completion or an exception), this automatically calls MemoryArchiver to
write a new versioned memory zip. It never overwrites a previous version,
and the new zip carries the full cumulative history of every prior session
forward inside it.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from gatekeeper.engines.memory_archive import MemoryArchiver


class OnboardingSession:
    def __init__(
        self,
        agent_name: str,
        journal_path: str = "gatekeeper/data/journal.jsonl",
        memory_dir: str = "gatekeeper/data/memory",
    ):
        self.agent_name = agent_name
        self.journal_path = journal_path
        self.archiver = MemoryArchiver(memory_dir=memory_dir)
        self.started_at: Optional[str] = None
        self.ended_at: Optional[str] = None
        self.events: List[Dict[str, Any]] = []
        self.written_snapshot_path: Optional[str] = None

    def log(self, note: str, **extra: Any) -> None:
        self.events.append({
            "at": datetime.now(timezone.utc).isoformat(),
            "note": note,
            **extra,
        })

    def __enter__(self) -> "OnboardingSession":
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.log("onboarding session started", agent=self.agent_name)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.ended_at = datetime.now(timezone.utc).isoformat()
        if exc_type is not None:
            self.log("session ended with exception", error=f"{exc_type.__name__}: {exc_val}")
        else:
            self.log("session ended normally")

        session_record = {
            "type": "onboarding_session",
            "agent_name": self.agent_name,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "events": self.events,
        }
        self.written_snapshot_path = self.archiver.write_snapshot(session_record, journal_path=self.journal_path)
        # Do not suppress exceptions — memory capture happens regardless, but
        # the exception (if any) still propagates.
        return False
