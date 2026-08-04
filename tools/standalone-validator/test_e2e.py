"""
End-to-end test with mocked network calls (Supabase, Shovels and Vercel are
all external services this can't reach from a test run, so we verify the
actual control flow instead: import -> claim -> gather -> outbox -> flush ->
rescore), plus the two failure paths that matter: Supabase unreachable
mid-cycle, and a write Supabase will never accept.

Run with: python test_e2e.py
"""
import json
import os
from unittest.mock import MagicMock, patch

import requests

import validator
from local_store import DEAD, LocalStore

TEST_DB = "e2e_test.db"

FAKE_QUEUE = [
    {"id": "lead-A", "address": "123 Main St", "city": "Edina", "county": "hennepin", "priority_score": 89.5, "gap_priority": 0.4},
    {"id": "lead-B", "address": "456 Oak Ave", "city": "Edina", "county": "hennepin", "priority_score": 87.2, "gap_priority": 0.35},
]

# lead-A resolves to a geo with a recent roof permit, lead-B to one with none.
GEO_BY_ADDRESS = {"123 Main St, Edina, MN": "geo-A", "456 Oak Ave, Edina, MN": "geo-B"}
PERMITS_BY_GEO = {
    "geo-A": [{"file_date": "2024-05-01", "permit_type": "Roof Replacement", "permit_number": "R-2024-001", "status": "closed"}],
    "geo-B": [],
}

call_log = []


def fresh_store():
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)
    return LocalStore(TEST_DB)


def fake_requests_get(url, headers=None, params=None, timeout=None):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    if "addresses/search" in url:
        resp.json.return_value = [{"geo_id": GEO_BY_ADDRESS[params["q"]]}]
    elif "permits/search" in url:
        resp.json.return_value = PERMITS_BY_GEO[params["geo_id"]]
    else:
        raise AssertionError(f"unexpected GET to {url}")
    return resp


def fake_db_select(self, table, params, timeout=20):
    call_log.append(("select", table, params))
    return FAKE_QUEUE


def fake_db_conditional_update(self, table, match, only_if, patch, timeout=20):
    call_log.append(("claim", match["id"]))
    return [{"id": match["id"]}]  # simulate winning the claim race


def fake_db_insert(self, table, rows, timeout=20):
    call_log.append(("insert", table, rows))
    return rows if isinstance(rows, list) else [rows]


def fake_db_update(self, table, match, patch, timeout=20):
    call_log.append(("update", table, match.get("id"), patch))
    return [patch]


def offline_db_call(self, *a, **kw):
    raise requests.ConnectionError("simulated: Supabase unreachable")


def fake_rescore_post(url, json=None, timeout=None):
    call_log.append(("rescore_trigger", url))
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"ok": True, "summary": {"gated_out_before_imagery": 1, "dropped_after_permit_check": 1}, "topUp": {"promoted": 5}}
    return resp


validator.SUPABASE_URL = "https://fake.supabase.co"
validator.SUPABASE_KEY = "fake-key"
validator.PERMIT_API_KEY = "fake-permit-key"

from supabase_client import SupabaseClient  # noqa: E402  (after the module-level config above)

db = SupabaseClient("https://fake.supabase.co", "fake-key")


# ---------------------------------------------------------------- happy path
with patch.object(SupabaseClient, "select", fake_db_select), \
     patch.object(SupabaseClient, "conditional_update", fake_db_conditional_update), \
     patch.object(SupabaseClient, "insert", fake_db_insert), \
     patch.object(SupabaseClient, "update", fake_db_update), \
     patch("requests.get", fake_requests_get), \
     patch("requests.post", fake_rescore_post):

    store = fresh_store()
    assert validator.run_cycle(db, store), "run_cycle should return True on success"

    kinds = [c[0] for c in call_log]
    assert kinds[0] == "select", f"expected import first, got {kinds}"
    assert "claim" in kinds, "expected a claim call"
    assert "insert" in kinds, "expected evidence_events insert (outbox flush)"
    assert "update" in kinds, "expected batch_leads update (outbox flush)"
    assert kinds[-1] == "rescore_trigger", "rescore must be triggered last, after evidence is synced"

    # The import must exclude already-checked leads, or releasing a lead back
    # to 'pending' for the real engine would hand it straight back to us.
    select_params = call_log[0][2]
    assert select_params["permit_checked_at"] == "is.null", \
        f"import must filter out already-checked leads, got {select_params}"

    # Local mirror got the imported leads.
    assert len(store.queued_leads(10)) == 2, "expected 2 mirrored leads"

    # Outbox fully drained.
    assert store.pending_outbox() == [], "expected empty outbox after a successful sync"

    # Hash chain recorded per lead, and distinct per lead.
    h_a, h_b = store.last_event_hash("lead-A", "permit_check"), store.last_event_hash("lead-B", "permit_check")
    assert h_a and h_b and h_a != h_b, "expected distinct hash chain entries for both leads"

    # --- the handoff to the real scoring engine ---
    patches = {c[2]: c[3] for c in call_log if c[0] == "update" and c[1] == "batch_leads"}
    for lead_id, patch_body in patches.items():
        assert patch_body["enrichment_status"] == "pending", (
            f"{lead_id} must be released to 'pending' -- /api/enrich/priority-worker only "
            f"selects pending rows, so any other status means the evidence is written but "
            f"the score is never recomputed. Got {patch_body['enrichment_status']!r}"
        )
        assert patch_body["permit_checked_at"], f"{lead_id} must record when it was checked"
        # permit_notes is read back with JSON.parse on the JS side -- a Python
        # repr (None/True) would parse-fail there but look fine here.
        notes = json.loads(patch_body["permit_notes"])
        assert notes["checked_by"] == "standalone_validator"

    assert patches["lead-A"]["permit_within_10y"] is True, "lead-A has a 2024 roof permit"
    assert patches["lead-B"]["permit_within_10y"] is False, "lead-B has no roof permits"
    assert json.loads(patches["lead-B"]["permit_notes"])["most_recent"] is None, \
        "empty result must serialize as JSON null, not Python None"

    # Found records are cached in the app's own permit directory, so the
    # rescore's own lookup doesn't re-bill Shovels for the same address.
    directory_writes = [c for c in call_log if c[0] == "insert" and c[1] == "permits"]
    assert len(directory_writes) == 1, "only lead-A had records to cache"
    for row in directory_writes[0][2]:
        assert "address_normalized" not in row, \
            "address_normalized is GENERATED ALWAYS -- supplying it makes Postgres reject the insert"
        assert row["source"] == "shovels" and row["address"].startswith("123 Main St")

    store.close()


# ------------------------------------------- Supabase unreachable mid-cycle
# Evidence must survive: queued locally, retried, and nothing lost.
call_log.clear()
with patch.object(SupabaseClient, "select", fake_db_select), \
     patch.object(SupabaseClient, "conditional_update", fake_db_conditional_update), \
     patch.object(SupabaseClient, "insert", offline_db_call), \
     patch.object(SupabaseClient, "update", offline_db_call), \
     patch("requests.get", fake_requests_get), \
     patch("requests.post", fake_rescore_post):

    store = fresh_store()
    validator.run_cycle(db, store)

    still_queued = store.pending_outbox()
    assert len(still_queued) == 5, f"expected 5 writes held locally (2 events + 1 directory + 2 patches), got {len(still_queued)}"
    assert all(i["attempts"] == 1 for i in still_queued), "each held write should show one failed attempt"
    assert not [c for c in call_log if c[0] == "rescore_trigger"], \
        "rescore must not be triggered when nothing synced"

# Supabase comes back: the same queued writes go through, nothing was lost.
with patch.object(SupabaseClient, "select", lambda self, t, p, timeout=20: []), \
     patch.object(SupabaseClient, "insert", fake_db_insert), \
     patch.object(SupabaseClient, "update", fake_db_update), \
     patch("requests.post", fake_rescore_post):

    validator.run_cycle(db, store)
    assert store.pending_outbox() == [], "recovery cycle should drain everything queued while offline"
    store.close()


# ------------------------------------- a write Supabase will never accept
# Must be parked after MAX_OUTBOX_ATTEMPTS instead of retried forever.
def permanently_rejected(self, *a, **kw):
    raise requests.HTTPError("400 Bad Request: column does not exist")


store = fresh_store()
store.enqueue_outbox("lead_patch", "lead-Z", {"nonexistent_column": 1})
with patch.object(SupabaseClient, "update", permanently_rejected):
    for cycle in range(validator.MAX_OUTBOX_ATTEMPTS):
        result = validator.flush_outbox(db, store)
    assert result["dead"] == 1, "a permanently failing write must be given up on, not retried forever"

assert store.pending_outbox() == [], "a parked write must stop consuming flush capacity"
assert store.dead_count() == 1, "parked writes stay inspectable"
row = store.conn.execute("SELECT synced, attempts, last_error FROM outbox WHERE lead_id='lead-Z'").fetchone()
assert row[0] == DEAD and row[1] == validator.MAX_OUTBOX_ATTEMPTS and "400" in row[2], \
    f"parked write should keep its attempt count and last error, got {row}"
store.close()

os.remove(TEST_DB)
print("ALL END-TO-END CHECKS PASSED")
