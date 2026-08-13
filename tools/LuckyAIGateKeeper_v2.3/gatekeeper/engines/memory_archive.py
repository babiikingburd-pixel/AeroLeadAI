"""
Memory archiver. REAL-NOW — real zip files, real filesystem, no
external dependency (zipfile + json are stdlib).

Each onboarding session, on exit, gets packaged into its own numbered zip
(v1.1, v1.2, v1.3, ...) alongside the package's own versioning convention,
but scoped to memory snapshots specifically. Every new zip carries the full
cumulative history forward (not just that session's delta) plus a pointer
back to the previous version, so any single zip is self-contained and any
prior zip remains untouched and independently readable.

Layout inside each memory zip:
    MANIFEST.json          — version, timestamp, previous_version, session count
    session_current.json   — this session's own record
    history_cumulative.json — every session record from v1.1 through this version
    journal_snapshot.jsonl — copy of the GateKeeper journal at capture time
"""
from __future__ import annotations
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


class MemoryArchiver:
    def __init__(self, memory_dir: str = "gatekeeper/data/memory", base_name: str = "gatekeeper_memory"):
        self.memory_dir = Path(memory_dir)
        self.base_name = base_name
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self._pattern = re.compile(rf"^{re.escape(base_name)}_v(\d+)\.(\d+)\.zip$")

    # ---- version bookkeeping ----
    def _existing_versions(self) -> List[Tuple[int, int]]:
        versions = []
        for f in self.memory_dir.glob(f"{self.base_name}_v*.zip"):
            m = self._pattern.match(f.name)
            if m:
                versions.append((int(m.group(1)), int(m.group(2))))
        return sorted(versions)

    def _next_version(self) -> Tuple[int, int]:
        versions = self._existing_versions()
        if not versions:
            return (1, 1)
        major, minor = versions[-1]
        return (major, minor + 1)

    def _version_str(self, v: Tuple[int, int]) -> str:
        return f"{v[0]}.{v[1]}"

    def _path_for(self, v: Tuple[int, int]) -> Path:
        return self.memory_dir / f"{self.base_name}_v{self._version_str(v)}.zip"

    def latest_version(self) -> Optional[str]:
        versions = self._existing_versions()
        return self._version_str(versions[-1]) if versions else None

    def list_versions(self) -> List[str]:
        return [self._version_str(v) for v in self._existing_versions()]

    # ---- write ----
    def write_snapshot(self, session_record: Dict[str, Any], journal_path: Optional[str] = None) -> str:
        """
        Never overwrites an existing version — always creates the next one.
        Returns the path to the new zip.
        """
        prior_versions = self._existing_versions()
        prior_str = self._version_str(prior_versions[-1]) if prior_versions else None

        cumulative = self.read_cumulative_history()
        cumulative.append(session_record)

        next_v = self._next_version()
        out_path = self._path_for(next_v)
        if out_path.exists():
            raise FileExistsError(f"refusing to overwrite existing memory snapshot: {out_path}")

        manifest = {
            "version": self._version_str(next_v),
            "previous_version": prior_str,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "session_count_cumulative": len(cumulative),
        }

        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("MANIFEST.json", json.dumps(manifest, indent=2, default=str))
            zf.writestr("session_current.json", json.dumps(session_record, indent=2, default=str))
            zf.writestr("history_cumulative.json", json.dumps(cumulative, indent=2, default=str))
            jp = Path(journal_path) if journal_path else None
            if jp and jp.exists():
                zf.write(jp, arcname="journal_snapshot.jsonl")

        return str(out_path)

    # ---- read ----
    def read_snapshot(self, version: Optional[str] = None) -> Dict[str, Any]:
        version = version or self.latest_version()
        if version is None:
            return {"manifest": None, "session_current": None, "history_cumulative": [], "journal_snapshot": None}

        v_tuple = tuple(int(x) for x in version.split("."))
        path = self._path_for(v_tuple)  # type: ignore[arg-type]
        if not path.exists():
            raise FileNotFoundError(f"no memory snapshot at version {version}")

        with zipfile.ZipFile(path, "r") as zf:
            manifest = json.loads(zf.read("MANIFEST.json"))
            session_current = json.loads(zf.read("session_current.json"))
            history_cumulative = json.loads(zf.read("history_cumulative.json"))
            journal_snapshot = None
            if "journal_snapshot.jsonl" in zf.namelist():
                journal_snapshot = zf.read("journal_snapshot.jsonl").decode("utf-8")

        return {
            "manifest": manifest,
            "session_current": session_current,
            "history_cumulative": history_cumulative,
            "journal_snapshot": journal_snapshot,
        }

    def read_cumulative_history(self) -> List[Dict[str, Any]]:
        """Cumulative history as of the latest existing snapshot (empty list if none yet)."""
        latest = self.latest_version()
        if latest is None:
            return []
        return self.read_snapshot(latest)["history_cumulative"]
