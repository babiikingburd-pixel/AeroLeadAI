"""
Hash-chained evidence events. Each claim about a property (a permit search
result, for instance) gets recorded with:
  - what was claimed
  - where it came from
  - when it was retrieved
  - a hash of the content
  - a hash chaining it to the previous claim of the same type for the same
    property

The chain means: if evidence for a lead is ever edited or deleted outside
this ledger, the hash chain breaks and that's detectable. This doesn't
replace score_history (which records SCORE changes) -- it's the raw
evidence layer underneath it, closer to what a permit lookup actually
returned before any scoring interpretation was applied.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone


def content_hash(claim_value: dict) -> str:
    canonical = json.dumps(claim_value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def event_hash(previous_hash: str | None, content_hash_value: str) -> str:
    basis = (previous_hash or "") + content_hash_value
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def build_evidence_event(
    lead_id: str,
    claim_type: str,
    claim_value: dict,
    source_type: str,
    crawler_id: str,
    previous_event_hash: str | None,
    source_locator: str | None = None,
    observed_at: str | None = None,
    confidence: float | None = None,
    crawler_version: str = "1.0",
) -> dict:
    c_hash = content_hash(claim_value)
    e_hash = event_hash(previous_event_hash, c_hash)
    return {
        "lead_id": lead_id,
        "claim_type": claim_type,
        "claim_value": claim_value,
        "source_type": source_type,
        "source_locator": source_locator,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "observed_at": observed_at,
        "crawler_id": crawler_id,
        "crawler_version": crawler_version,
        "confidence": confidence,
        "content_hash": c_hash,
        "previous_event_hash": previous_event_hash,
        "event_hash": e_hash,
    }
