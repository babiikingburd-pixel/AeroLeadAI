"""
Human approval gate. REAL-NOW, stdlib only.

Some claims should never auto-promote to REAL-NOW purely on engine output —
this gate lets a claim be marked "pending_approval" and requires an explicit,
journaled human decision (approve/reject with a note) before it can be
treated as authoritative. This mirrors the same pattern already used in
The Office / AI Executive Engine (dry-run default, human escalation for
high-risk items) — implemented here as its own reusable, testable piece
rather than assumed.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid


@dataclass
class ApprovalRequest:
    claim: str
    proposed_classification: str
    reason: str
    status: str = "pending"  # pending | approved | rejected
    decided_by: Optional[str] = None
    decision_note: str = ""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    decided_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class ApprovalGate:
    def __init__(self):
        self._requests: Dict[str, ApprovalRequest] = {}

    def requires_approval(self, classification: str, confidence: float, threshold: float = 0.9) -> bool:
        """
        High-stakes rule: a REAL-NOW claim below the confidence threshold,
        or any claim explicitly flagged high-risk elsewhere, should not
        silently auto-promote. Callers can also force a gate regardless
        of this check.
        """
        return classification == "REAL-NOW" and confidence < threshold

    def request(self, claim: str, proposed_classification: str, reason: str) -> ApprovalRequest:
        req = ApprovalRequest(claim=claim, proposed_classification=proposed_classification, reason=reason)
        self._requests[req.id] = req
        return req

    def decide(self, request_id: str, approved: bool, decided_by: str, note: str = "") -> ApprovalRequest:
        req = self._requests[request_id]
        req.status = "approved" if approved else "rejected"
        req.decided_by = decided_by
        req.decision_note = note
        req.decided_at = datetime.now(timezone.utc).isoformat()
        return req

    def get(self, request_id: str) -> Optional[ApprovalRequest]:
        return self._requests.get(request_id)
