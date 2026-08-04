"""
AeroLeadAI Standalone External Validator

WHAT THIS IS
A genuinely separate process from the Next.js/Vercel app. It:
  - IMPORTS the current priority queue directly from Supabase
  - Independently gathers real evidence (permit lookups via Shovels.ai,
    called directly -- not routed through Vercel) for queued leads
  - EXPORTS that evidence back to Supabase: into the app's own `permits`
    directory, as raw fields on batch_leads, and as hash-chained provenance
    records in evidence_events (so every claim is auditable)
  - Works durably offline: everything gathered goes into a local SQLite
    outbox first: if Supabase is unreachable, nothing is lost, it retries
    next cycle
  - Runs forever, as a real loop, because this is a real process on a real
    always-on machine -- not a serverless function with a timeout

WHAT THIS DELIBERATELY DOES NOT DO
It does not compute priority_score, confidence_score, or tier. That logic
lives in exactly one place: lib/twincities/priorityEngine.js. A prior
mistake this session (a dormant Python "evidence_engine.py" that quietly
duplicated the JS scoring model) is not being repeated. This tool writes
evidence; it asks the existing rescore mechanism to act on it.

HOW RESCORING HAPPENS -- AND WHY THE CLAIM IS RELEASED
The only code path that rescores a lead is /api/enrich/priority-worker,
and it only ever selects rows with enrichment_status = 'pending'. So a
validator that left a lead in a terminal status ('permit_done',
'complete_downranked') would write evidence that the real engine could then
never see -- the row's permit fields would update and its priority_score
would stay stale forever. That is exactly the bug this version fixes.

The sequence is therefore: CLAIM the lead (pending -> claimed, so the
Vercel-side worker can't race us on it) -> gather evidence -> write the
evidence AND release the claim (claimed -> pending) in the same durable
patch -> trigger priority-worker, which picks the lead back up and runs the
real engine on it.

To keep that handoff from costing a second billed Shovels call, whatever
records we found are also written into the app's own `permits` directory
first. /api/permit-lookup reads that directory before it spends an external
call, so the worker's re-lookup is a free directory hit. When we found
nothing there is nothing to cache, and the worker will re-query Shovels for
that address -- an honest, small duplicate cost on empty addresses only.

Leads are imported with permit_checked_at IS NULL, so releasing a lead back
to 'pending' can't put it back in this tool's own intake -- once its permit
has been checked, this validator will not pick it up again.

CONFIG
Set these as environment variables (or edit the constants below):
  SUPABASE_URL, SUPABASE_KEY   -- from your Supabase project settings
  PERMIT_API_KEY               -- Shovels.ai key (optional; without it,
                                    permit checks still run, just find
                                    nothing beyond what's already logged)
  AEROLEAD_BASE_URL             -- your Vercel deployment, for rescore triggers
  AEROLEAD_BATCH_LIMIT          -- leads per cycle (default 25)
  AEROLEAD_INTERVAL_SECONDS     -- pause between cycles (default 60)
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from evidence_ledger import build_evidence_event
from local_store import LocalStore
from permit_lookup import directory_rows, shovels_lookup, summarize_permit_check
from supabase_client import SupabaseClient


def load_config_env(path: Path = Path(__file__).with_name("config.env")) -> None:
    """Read config.env into the environment, if present. Real environment
    variables win, so an operator can override a single setting for one run
    without editing the file. Kept as a few lines here rather than a
    python-dotenv dependency -- the whole point of this tool is that its
    install is `pip install requests` and nothing else can break."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


load_config_env()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
PERMIT_API_KEY = os.environ.get("PERMIT_API_KEY", "")
BASE_URL = os.environ.get("AEROLEAD_BASE_URL", "https://aero-lead-ai.vercel.app")
BATCH_LIMIT = int(os.environ.get("AEROLEAD_BATCH_LIMIT", "25"))
INTERVAL_SECONDS = int(os.environ.get("AEROLEAD_INTERVAL_SECONDS", "60"))
CRAWLER_ID = os.environ.get("AEROLEAD_WORKER_ID", f"desktop-validator-{os.getpid()}")

BACKOFF_START = 10
BACKOFF_MAX = 300

# After this many consecutive failures a queued write is parked as dead
# rather than retried forever -- see local_store's module docstring.
MAX_OUTBOX_ATTEMPTS = 5

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("validator")

_stop = False


def _handle_stop(signum, frame):
    global _stop
    log.info("Stop requested -- finishing current cycle, then exiting.")
    _stop = True


signal.signal(signal.SIGINT, _handle_stop)
if hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, _handle_stop)


def require_config() -> None:
    missing = [n for n, v in [("SUPABASE_URL", SUPABASE_URL), ("SUPABASE_KEY", SUPABASE_KEY)] if not v]
    if missing:
        log.error("Missing required config: %s. Set them as environment variables and retry.", ", ".join(missing))
        sys.exit(1)
    if not PERMIT_API_KEY:
        log.warning("PERMIT_API_KEY not set -- permit checks will run but won't find anything beyond what's already logged manually.")


def import_queue(db: SupabaseClient, store: LocalStore, limit: int) -> list[dict]:
    """IMPORT step: pull the current priority queue from Supabase into local
    storage. permit_checked_at IS NULL keeps this to leads nobody has checked
    yet -- without it, releasing a lead back to 'pending' for the real engine
    would hand it straight back to this tool on the next cycle and re-bill the
    permit lookup in a loop."""
    rows = db.select("batch_leads", {
        "select": "id,address,city,county,priority_score,gap_priority",
        "enrichment_queue": "eq.priority",
        "enrichment_status": "eq.pending",
        "permit_checked_at": "is.null",
        "order": "gap_priority.desc.nullslast,priority_score.desc.nullslast",
        "limit": str(limit),
    })
    store.upsert_queue_mirror(rows)
    return rows


def claim_lead(db: SupabaseClient, lead_id: str) -> bool:
    """Atomic claim, same pattern as the JS worker: only succeeds if the
    row is still 'pending' at the moment of the update, so two validators
    (or this tool and the Vercel-side worker) racing on the same lead can't
    both win. The claim is released again by the lead_patch queued in
    gather_permit_evidence -- that patch lives in the durable outbox, so a
    crash mid-cycle leaves the lead claimed only until the next successful
    flush, not permanently."""
    try:
        result = db.conditional_update(
            "batch_leads",
            match={"id": lead_id},
            only_if={"enrichment_status": "pending"},
            patch={
                "enrichment_status": "claimed",
                "enrichment_worker_id": CRAWLER_ID,
                "enrichment_started_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return len(result) > 0
    except requests.RequestException as e:
        log.error("Claim failed for %s: %s", lead_id, e)
        return False


def release_claim(db: SupabaseClient, lead_id: str) -> None:
    """Put a lead we claimed but couldn't gather evidence for back on the
    queue immediately. Without this, a failed permit lookup would strand the
    lead in 'claimed' with no evidence written and no outbox entry to
    eventually release it."""
    try:
        db.update("batch_leads", {"id": lead_id}, {"enrichment_status": "pending", "enrichment_worker_id": None})
    except requests.RequestException as e:
        log.warning("Could not release claim on %s (it will need a manual reset): %s", lead_id, e)


def gather_permit_evidence(store: LocalStore, lead: dict) -> dict:
    """The real, independent evidence-gathering step. Works with zero
    Supabase or Vercel connectivity -- only needs to reach Shovels.ai."""
    address = f"{lead.get('address')}, {lead.get('city')}, MN"
    try:
        result = shovels_lookup(address, PERMIT_API_KEY) if PERMIT_API_KEY else {"records": [], "source": "no_api_key"}
    except requests.RequestException as e:
        log.warning("Permit lookup failed for %s: %s", address, e)
        return {"ok": False, "error": str(e)}

    records = result.get("records", []) if result else []
    summary = summarize_permit_check(records)

    claim_value = {**summary, "address": address}
    prev_hash = store.last_event_hash(lead["lead_id"], "permit_check")
    event = build_evidence_event(
        lead_id=lead["lead_id"], claim_type="permit_check", claim_value=claim_value,
        source_type=result.get("source", "unknown") if result else "no_api_key",
        crawler_id=CRAWLER_ID, previous_event_hash=prev_hash,
        confidence=0.9 if records else 0.5,
    )
    store.set_last_event_hash(lead["lead_id"], "permit_check", event["event_hash"])
    store.enqueue_outbox("evidence_event", lead["lead_id"], event)

    # Cache what we found in the app's own permit directory BEFORE releasing
    # the lead, so the rescore's own lookup is a free directory hit rather
    # than a second billed Shovels call for the same address. Queued ahead of
    # the lead_patch because the outbox flushes in insertion order.
    if records:
        store.enqueue_outbox(
            "permit_directory", lead["lead_id"],
            directory_rows(address, lead.get("city"), lead.get("county"), records),
        )

    permit_notes = json.dumps({
        "checked_at": event["retrieved_at"],
        "source": event["source_type"],
        "total_records": summary["total_records"],
        "roof_permits": summary["roof_permits"],
        "roof_permits_within_10y": summary["roof_permits_within_10y"],
        "most_recent": summary["most_recent"],
        "checked_by": "standalone_validator",
    })
    lead_patch = {
        "permit_within_10y": summary["permit_within_10y"],
        "permit_notes": permit_notes,
        "permit_evidence_status": "verified" if summary["total_records"] else "none_found",
        "permit_checked_at": event["retrieved_at"],
        # Release the claim. The lead has to be back in 'pending' for
        # /api/enrich/priority-worker to select it and run the real scoring
        # engine -- see this module's docstring. It cannot come back to this
        # tool, because import_queue only takes leads with no
        # permit_checked_at, which this same patch sets.
        "enrichment_status": "pending",
        "enrichment_worker_id": None,
    }
    store.enqueue_outbox("lead_patch", lead["lead_id"], lead_patch)
    return {"ok": True, "summary": summary}


def flush_outbox(db: SupabaseClient, store: LocalStore) -> dict:
    """EXPORT step: push everything durably queued locally back to Supabase.
    Called every cycle regardless of what just happened, so a failure last
    cycle gets retried this cycle automatically."""
    pending = store.pending_outbox()
    synced, failed, dead = 0, 0, 0
    for item in pending:
        try:
            payload = json.loads(item["payload"])
            if item["kind"] == "evidence_event":
                db.insert("evidence_events", payload)
            elif item["kind"] == "permit_directory":
                db.insert("permits", payload)
            elif item["kind"] == "lead_patch":
                db.update("batch_leads", {"id": item["lead_id"]}, payload)
            else:
                raise ValueError(f"unknown outbox kind {item['kind']!r}")
            store.mark_synced(item["id"])
            synced += 1
        # Deliberately broad: a malformed payload (ValueError) must be parked
        # like any other permanent failure, not allowed to abort the flush and
        # strand every item queued behind it.
        except Exception as e:  # noqa: BLE001
            attempts = store.mark_failed(item["id"], str(e))
            if attempts >= MAX_OUTBOX_ATTEMPTS:
                store.mark_dead(item["id"])
                dead += 1
                log.error("Giving up on %s for lead %s after %d attempts: %s",
                          item["kind"], item["lead_id"], attempts, e)
            else:
                failed += 1
    return {"synced": synced, "failed": failed, "dead": dead, "pending_before": len(pending)}


def trigger_rescore(limit: int) -> dict | None:
    """Ask the real engine to rescore. Best-effort: if Vercel is down, this
    just doesn't run -- evidence already saved isn't lost, and the lead is
    sitting in 'pending' with its permit fields populated, so it'll be picked
    up whenever priority-worker next runs from any trigger."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/enrich/priority-worker",
            json={"limit": limit, "workerId": CRAWLER_ID, "autoTopUp": True, "skipImages": True},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        log.warning("Rescore trigger unreachable (evidence already saved, will retry later): %s", e)
        return None


def run_cycle(db: SupabaseClient, store: LocalStore) -> bool:
    log.info("IMPORT: pulling priority queue...")
    try:
        rows = import_queue(db, store, BATCH_LIMIT)
    except requests.RequestException as e:
        log.error("Could not reach Supabase to import queue: %s", e)
        rows = []

    if rows:
        log.info("Imported %d leads. Gathering evidence...", len(rows))
        for lead in rows:
            lead_id = lead.get("id") or lead.get("lead_id")
            if not claim_lead(db, lead_id):
                log.info("Lead %s already claimed elsewhere, skipping.", lead_id)
                continue
            result = gather_permit_evidence(store, {"lead_id": lead_id, **lead})
            if result.get("ok"):
                s = result["summary"]
                log.info("  %s -> %d permit record(s), recent roof permit: %s",
                          lead.get("address", lead_id), s["total_records"], s["permit_within_10y"])
            else:
                # Nothing was queued for this lead, so nothing will release it
                # later. Put it back on the queue now.
                release_claim(db, lead_id)
    else:
        log.info("Nothing new to import this cycle.")

    log.info("EXPORT: flushing local outbox to Supabase...")
    flush_result = flush_outbox(db, store)
    log.info("  synced=%d retrying=%d gave_up=%d (pending before flush: %d)",
              flush_result["synced"], flush_result["failed"], flush_result["dead"], flush_result["pending_before"])

    if flush_result["synced"] > 0:
        log.info("Triggering rescore on the real engine...")
        rescore = trigger_rescore(BATCH_LIMIT)
        if rescore:
            summary = rescore.get("summary", {})
            log.info("  rescored: gated_out=%d dropped=%d top_up=%s",
                      summary.get("gated_out_before_imagery", 0),
                      summary.get("dropped_after_permit_check", 0),
                      (rescore.get("topUp") or {}).get("promoted"))

    return True


def main() -> None:
    require_config()
    log.info("AeroLeadAI standalone validator starting")
    log.info("supabase=%s  vercel=%s  batch_limit=%d  interval=%ds  id=%s",
              SUPABASE_URL, BASE_URL, BATCH_LIMIT, INTERVAL_SECONDS, CRAWLER_ID)

    db = SupabaseClient(SUPABASE_URL, SUPABASE_KEY)
    store = LocalStore()

    backoff = BACKOFF_START
    cycles = 0
    try:
        while not _stop:
            cycles += 1
            log.info("--- cycle %d ---", cycles)
            try:
                run_cycle(db, store)
                backoff = BACKOFF_START
                sleep_for = INTERVAL_SECONDS
            except Exception as e:  # noqa: BLE001 - a bad cycle must not kill the loop
                log.error("Cycle failed: %s", e)
                sleep_for = backoff
                backoff = min(backoff * 2, BACKOFF_MAX)

            dead = store.dead_count()
            if dead:
                log.warning("%d queued write(s) were given up on -- inspect: "
                            "sqlite3 validator_local.db \"select kind, lead_id, last_error from outbox where synced=2\"", dead)

            for _ in range(sleep_for):
                if _stop:
                    break
                time.sleep(1)
    finally:
        store.close()
        log.info("Stopped after %d cycles.", cycles)


if __name__ == "__main__":
    main()
