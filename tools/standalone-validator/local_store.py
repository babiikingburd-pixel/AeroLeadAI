"""
Local durable storage for the standalone validator.

Two jobs:
  1. Mirror of the Supabase priority queue, so the validator can keep working
     from local state even if Supabase is briefly unreachable.
  2. Durable outbox -- every write meant for Supabase goes here FIRST. If the
     network call succeeds, it's marked synced. If it fails, it stays queued
     and gets retried on the next cycle. Nothing gathered locally is ever
     lost to a dropped connection.

This is genuinely offline-capable for evidence GATHERING (permit lookups
work with just an internet connection to the permit source, not to
Supabase). It is not offline-capable for RESCORING -- that still needs
Supabase reachable, by design, so there's exactly one place scores get
computed (see validator.py's module docstring for why).

Outbox rows have three states, not two: 0 = pending, 1 = synced, 2 = dead.
A payload Supabase rejects for a reason retrying won't fix (a bad column, a
constraint violation) would otherwise be retried forever and, once there
were more than a page of them, crowd real work out of every flush. After
MAX_ATTEMPTS the row is parked as dead with its last error kept, so it stops
consuming flush capacity but is still there to inspect.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS queue_mirror (
    lead_id TEXT PRIMARY KEY,
    address TEXT,
    city TEXT,
    county TEXT,
    priority_score REAL,
    gap_priority REAL,
    pulled_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    lead_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at REAL NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    synced_at REAL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(synced, created_at);

CREATE TABLE IF NOT EXISTS event_hash_chain (
    lead_id TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    last_event_hash TEXT NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (lead_id, claim_type)
);
"""

PENDING, SYNCED, DEAD = 0, 1, 2


class LocalStore:
    def __init__(self, db_path: str = "validator_local.db"):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def upsert_queue_mirror(self, leads: list[dict]) -> None:
        now = time.time()
        with self.conn:
            for lead in leads:
                self.conn.execute(
                    """INSERT INTO queue_mirror (lead_id, address, city, county, priority_score, gap_priority, pulled_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(lead_id) DO UPDATE SET
                         address=excluded.address, city=excluded.city, county=excluded.county,
                         priority_score=excluded.priority_score, gap_priority=excluded.gap_priority,
                         pulled_at=excluded.pulled_at""",
                    (lead["id"], lead.get("address"), lead.get("city"), lead.get("county"),
                     lead.get("priority_score"), lead.get("gap_priority"), now),
                )

    def queued_leads(self, limit: int = 25) -> list[dict]:
        cur = self.conn.execute(
            "SELECT lead_id, address, city, county, priority_score, gap_priority FROM queue_mirror "
            "ORDER BY gap_priority DESC, priority_score DESC LIMIT ?",
            (limit,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def remove_from_mirror(self, lead_id: str) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM queue_mirror WHERE lead_id = ?", (lead_id,))

    def enqueue_outbox(self, kind: str, lead_id: str, payload: dict | list) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO outbox (kind, lead_id, payload, created_at) VALUES (?, ?, ?, ?)",
                (kind, lead_id, json.dumps(payload), time.time()),
            )
            return cur.lastrowid

    def pending_outbox(self, limit: int = 100) -> list[dict]:
        cur = self.conn.execute(
            "SELECT id, kind, lead_id, payload, attempts FROM outbox WHERE synced = ? ORDER BY created_at LIMIT ?",
            (PENDING, limit),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def mark_synced(self, outbox_id: int) -> None:
        with self.conn:
            self.conn.execute(
                "UPDATE outbox SET synced=?, synced_at=? WHERE id=?", (SYNCED, time.time(), outbox_id)
            )

    def mark_failed(self, outbox_id: int, error: str) -> int:
        """Record a failed sync attempt and return the new attempt count, so
        the caller can decide whether this payload is worth retrying."""
        with self.conn:
            self.conn.execute(
                "UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id=?",
                (error, outbox_id),
            )
        cur = self.conn.execute("SELECT attempts FROM outbox WHERE id=?", (outbox_id,))
        row = cur.fetchone()
        return row[0] if row else 0

    def mark_dead(self, outbox_id: int) -> None:
        with self.conn:
            self.conn.execute("UPDATE outbox SET synced=? WHERE id=?", (DEAD, outbox_id))

    def dead_count(self) -> int:
        cur = self.conn.execute("SELECT COUNT(*) FROM outbox WHERE synced = ?", (DEAD,))
        return cur.fetchone()[0]

    def last_event_hash(self, lead_id: str, claim_type: str) -> str | None:
        cur = self.conn.execute(
            "SELECT last_event_hash FROM event_hash_chain WHERE lead_id=? AND claim_type=?",
            (lead_id, claim_type),
        )
        row = cur.fetchone()
        return row[0] if row else None

    def set_last_event_hash(self, lead_id: str, claim_type: str, event_hash: str) -> None:
        with self.conn:
            self.conn.execute(
                """INSERT INTO event_hash_chain (lead_id, claim_type, last_event_hash, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(lead_id, claim_type) DO UPDATE SET
                     last_event_hash=excluded.last_event_hash, updated_at=excluded.updated_at""",
                (lead_id, claim_type, event_hash, time.time()),
            )

    def export_lead(self, lead_id: str, out_dir: Path) -> None:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        cur = self.conn.execute("SELECT * FROM queue_mirror WHERE lead_id=?", (lead_id,))
        cols = [d[0] for d in cur.description]
        row = cur.fetchone()
        property_data = dict(zip(cols, row)) if row else {"lead_id": lead_id, "note": "not in local mirror"}
        (out_dir / "property.json").write_text(json.dumps(property_data, indent=2))

        cur = self.conn.execute(
            "SELECT * FROM outbox WHERE lead_id=? ORDER BY created_at", (lead_id,)
        )
        cols = [d[0] for d in cur.description]
        events = [dict(zip(cols, r)) for r in cur.fetchall()]
        with open(out_dir / "evidence.jsonl", "w") as f:
            for e in events:
                f.write(json.dumps(e) + "\n")

        (out_dir / "manifest.json").write_text(json.dumps({
            "lead_id": lead_id, "exported_at": time.time(), "event_count": len(events),
        }, indent=2))

    def close(self) -> None:
        self.conn.close()
