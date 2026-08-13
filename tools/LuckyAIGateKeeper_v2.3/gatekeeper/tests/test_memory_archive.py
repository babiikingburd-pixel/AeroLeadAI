import os
import shutil
import tempfile
import zipfile
from gatekeeper.engines.memory_archive import MemoryArchiver
from gatekeeper.engines.onboarding_session import OnboardingSession


def _tmp_dir():
    return tempfile.mkdtemp(prefix="gk_memory_test_")


def test_first_snapshot_is_v1_1():
    d = _tmp_dir()
    archiver = MemoryArchiver(memory_dir=d)
    path = archiver.write_snapshot({"note": "first session"})
    assert path.endswith("_v1.1.zip")
    assert os.path.exists(path)
    shutil.rmtree(d)


def test_versions_increment_and_never_overwrite():
    d = _tmp_dir()
    archiver = MemoryArchiver(memory_dir=d)
    p1 = archiver.write_snapshot({"note": "session 1"})
    p2 = archiver.write_snapshot({"note": "session 2"})
    p3 = archiver.write_snapshot({"note": "session 3"})
    assert p1.endswith("_v1.1.zip")
    assert p2.endswith("_v1.2.zip")
    assert p3.endswith("_v1.3.zip")
    # all three files still exist independently — nothing got overwritten
    assert os.path.exists(p1) and os.path.exists(p2) and os.path.exists(p3)
    assert archiver.list_versions() == ["1.1", "1.2", "1.3"]
    shutil.rmtree(d)


def test_cumulative_history_grows_and_prior_zips_stay_unchanged():
    d = _tmp_dir()
    archiver = MemoryArchiver(memory_dir=d)
    archiver.write_snapshot({"note": "session 1"})
    p2 = archiver.write_snapshot({"note": "session 2"})

    # v1.2's cumulative history should contain BOTH sessions
    snap2 = archiver.read_snapshot("1.2")
    assert len(snap2["history_cumulative"]) == 2
    assert snap2["history_cumulative"][0]["note"] == "session 1"
    assert snap2["history_cumulative"][1]["note"] == "session 2"

    # v1.1 itself is untouched — still only contains session 1
    snap1 = archiver.read_snapshot("1.1")
    assert len(snap1["history_cumulative"]) == 1
    shutil.rmtree(d)


def test_snapshot_is_a_real_readable_zip_file():
    d = _tmp_dir()
    archiver = MemoryArchiver(memory_dir=d)
    path = archiver.write_snapshot({"note": "session 1"})
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
    assert "MANIFEST.json" in names
    assert "session_current.json" in names
    assert "history_cumulative.json" in names
    shutil.rmtree(d)


def test_journal_included_when_present():
    d = _tmp_dir()
    journal_path = os.path.join(d, "journal.jsonl")
    with open(journal_path, "w") as f:
        f.write('{"type": "assessment", "claim": "test"}\n')
    archiver = MemoryArchiver(memory_dir=d)
    path = archiver.write_snapshot({"note": "s1"}, journal_path=journal_path)
    with zipfile.ZipFile(path) as zf:
        assert "journal_snapshot.jsonl" in zf.namelist()
        content = zf.read("journal_snapshot.jsonl").decode("utf-8")
    assert "test" in content
    shutil.rmtree(d)


def test_onboarding_session_writes_snapshot_on_exit():
    d = _tmp_dir()
    with OnboardingSession(agent_name="Claude", memory_dir=d) as session:
        session.log("did some work")
    assert session.written_snapshot_path is not None
    assert session.written_snapshot_path.endswith("_v1.1.zip")
    assert os.path.exists(session.written_snapshot_path)
    shutil.rmtree(d)


def test_onboarding_session_captures_snapshot_even_on_exception():
    d = _tmp_dir()
    written_path = None
    try:
        with OnboardingSession(agent_name="Claude", memory_dir=d) as session:
            session.log("about to fail")
            raise RuntimeError("boom")
    except RuntimeError:
        written_path = session.written_snapshot_path
    assert written_path is not None
    assert os.path.exists(written_path)
    shutil.rmtree(d)


def test_two_onboarding_sessions_increment_versions_across_runs():
    d = _tmp_dir()
    with OnboardingSession(agent_name="Claude", memory_dir=d) as s1:
        s1.log("session one work")
    with OnboardingSession(agent_name="Claude", memory_dir=d) as s2:
        s2.log("session two work")
    assert s1.written_snapshot_path.endswith("_v1.1.zip")
    assert s2.written_snapshot_path.endswith("_v1.2.zip")
    snap2 = MemoryArchiver(memory_dir=d).read_snapshot("1.2")
    assert len(snap2["history_cumulative"]) == 2
    shutil.rmtree(d)
