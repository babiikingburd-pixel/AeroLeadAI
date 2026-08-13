import os
import shutil
import tempfile
import zipfile
import pytest

from gatekeeper.engines.session_driver import SessionDriver, NoActiveSessionError


def _driver(tmpdir):
    return SessionDriver(
        journal_path=os.path.join(tmpdir, "journal.jsonl"),
        memory_dir=os.path.join(tmpdir, "memory"),
        state_path=os.path.join(tmpdir, ".session_state.json"),
    )


def test_exit_without_start_raises():
    tmpdir = tempfile.mkdtemp()
    try:
        d = _driver(tmpdir)
        with pytest.raises(NoActiveSessionError):
            d.exit()
    finally:
        shutil.rmtree(tmpdir)


def test_start_log_exit_writes_real_zip():
    tmpdir = tempfile.mkdtemp()
    try:
        d = _driver(tmpdir)
        d.start(agent_name="Claude")
        d.log("ran Context Alignment Report")
        d.log("assessed 2 claims")
        path = d.exit(reason="user said exit")

        assert os.path.exists(path)
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            assert "MANIFEST.json" in names
            assert "session_current.json" in names
            assert "history_cumulative.json" in names
            import json
            current = json.loads(zf.read("session_current.json"))
            notes = [e["note"] for e in current["events"]]
            assert "ran Context Alignment Report" in notes
            assert "assessed 2 claims" in notes
            assert "user said exit" in notes
    finally:
        shutil.rmtree(tmpdir)


def test_state_file_cleared_after_exit():
    tmpdir = tempfile.mkdtemp()
    try:
        d = _driver(tmpdir)
        d.start(agent_name="Claude")
        d.exit()
        assert d.status() == {"active": False}
        # a second exit with no active session must raise, not silently no-op
        with pytest.raises(NoActiveSessionError):
            d.exit()
    finally:
        shutil.rmtree(tmpdir)


def test_double_start_without_exit_raises():
    tmpdir = tempfile.mkdtemp()
    try:
        d = _driver(tmpdir)
        d.start(agent_name="Claude")
        with pytest.raises(RuntimeError):
            d.start(agent_name="Claude")
    finally:
        shutil.rmtree(tmpdir)


def test_cumulative_history_grows_across_sessions():
    tmpdir = tempfile.mkdtemp()
    try:
        d = _driver(tmpdir)
        d.start(agent_name="Claude")
        d.log("session one work")
        p1 = d.exit()

        d.start(agent_name="Claude")
        d.log("session two work")
        p2 = d.exit()

        import json
        with zipfile.ZipFile(p2) as zf:
            history = json.loads(zf.read("history_cumulative.json"))
        assert len(history) == 2
        assert p1 != p2
    finally:
        shutil.rmtree(tmpdir)
