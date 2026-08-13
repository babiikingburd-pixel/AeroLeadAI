"""
SessionDriver — wires an explicit "exit" signal to OnboardingSession.__exit__.

The gap this closes: OnboardingSession is a Python context manager. Its
memory-capture code only runs when the `with` block it's used in actually
closes. Nothing before this file connected "the user typed/said exit" to
that closure — an agent driving the package had to remember to structure
its whole working session inside one `with OnboardingSession(...):` block
and never had a way to end that block on an external signal arriving
mid-session.

SessionDriver is a small persistent-state wrapper around OnboardingSession
that survives across separate process invocations (each CLI call is its own
python process; the state file is what carries the session forward between
them). It does NOT keep a `with` block open across process boundaries —
that's impossible. Instead, on `exit`, it reconstructs an OnboardingSession-
equivalent record from the accumulated state and calls the same
MemoryArchiver.write_snapshot() that OnboardingSession.__exit__ calls, so
the resulting memory zip is identical in shape to one OnboardingSession
would have produced.

State file: gatekeeper/data/.session_state.json (deleted on exit; a stray
double-exit with no active session is reported, not silently ignored).

CLI:
    python -m gatekeeper.engines.session_driver start --agent Claude
    python -m gatekeeper.engines.session_driver log "did a thing"
    python -m gatekeeper.engines.session_driver exit
    python -m gatekeeper.engines.session_driver status
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from gatekeeper.engines.memory_archive import MemoryArchiver

_DEFAULT_STATE_PATH = "gatekeeper/data/.session_state.json"


class NoActiveSessionError(RuntimeError):
    pass


class SessionDriver:
    def __init__(
        self,
        journal_path: str = "gatekeeper/data/journal.jsonl",
        memory_dir: str = "gatekeeper/data/memory",
        state_path: str = _DEFAULT_STATE_PATH,
    ):
        self.journal_path = journal_path
        self.memory_dir = memory_dir
        self.state_path = Path(state_path)

    # ---- state I/O ----
    def _read_state(self) -> Optional[Dict[str, Any]]:
        if not self.state_path.exists():
            return None
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def _write_state(self, state: Dict[str, Any]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")

    # ---- lifecycle ----
    def start(self, agent_name: str) -> Dict[str, Any]:
        if self._read_state() is not None:
            raise RuntimeError(
                "a session is already active (state file exists) — call exit() first, "
                "or use status() to inspect it"
            )
        state = {
            "agent_name": agent_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "events": [{"at": datetime.now(timezone.utc).isoformat(), "note": "onboarding session started", "agent": agent_name}],
        }
        self._write_state(state)
        return state

    def log(self, note: str, **extra: Any) -> Dict[str, Any]:
        state = self._read_state()
        if state is None:
            raise NoActiveSessionError("no active session — call start() first")
        state["events"].append({"at": datetime.now(timezone.utc).isoformat(), "note": note, **extra})
        self._write_state(state)
        return state

    def status(self) -> Dict[str, Any]:
        state = self._read_state()
        if state is None:
            return {"active": False}
        return {"active": True, **state}

    def exit(self, reason: str = "exit signal received") -> str:
        """
        The literal wiring point: call this when the user says/sends "exit".
        Produces the same memory-zip shape OnboardingSession.__exit__ would,
        then clears the state file so a repeat exit is reported, not silent.
        """
        state = self._read_state()
        if state is None:
            raise NoActiveSessionError("no active session to exit — nothing was captured")

        state["events"].append({"at": datetime.now(timezone.utc).isoformat(), "note": reason})
        ended_at = datetime.now(timezone.utc).isoformat()

        session_record = {
            "type": "onboarding_session",
            "agent_name": state["agent_name"],
            "started_at": state["started_at"],
            "ended_at": ended_at,
            "events": state["events"],
        }

        archiver = MemoryArchiver(memory_dir=self.memory_dir)
        snapshot_path = archiver.write_snapshot(session_record, journal_path=self.journal_path)

        self.state_path.unlink(missing_ok=True)
        return snapshot_path


def main(argv: Optional[List[str]] = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("Usage: python -m gatekeeper.engines.session_driver <start|log|exit|status> [args]")
        return 2

    cmd = argv[0]
    driver = SessionDriver()

    try:
        if cmd == "start":
            agent = "Claude"
            if "--agent" in argv:
                agent = argv[argv.index("--agent") + 1]
            result = driver.start(agent)
        elif cmd == "log":
            note = " ".join(argv[1:]).strip() or "(no note)"
            result = driver.log(note)
        elif cmd == "exit":
            path = driver.exit()
            print(json.dumps({"written_snapshot_path": path}, indent=2))
            return 0
        elif cmd == "status":
            result = driver.status()
        else:
            print(f"Unknown command: {cmd}")
            return 2
    except (NoActiveSessionError, RuntimeError) as exc:
        print(json.dumps({"error": str(exc)}, indent=2))
        return 1

    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
