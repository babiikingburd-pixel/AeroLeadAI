"""
Investigator. This is the piece that turns GateKeeper from "classify a
claim from whatever evidence you already have" into "go test the claim
and see what actually happens."

Given a probe function (something that calls a real adapter), it:
1. Runs the probe.
2. If it fails, classifies the failure as TRANSIENT or PERMANENT using a
   simple, inspectable rule set (timeouts/connection errors/rate-limit-style
   messages = transient; auth/permission/not-found = permanent).
3. Retries transient failures with exponential backoff, up to max_retries.
4. Returns a real Evidence object reflecting what actually happened —
   verified=True only if the probe genuinely succeeded.

This directly implements "we can't" -> investigate why -> distinguish
temporary from true limits, instead of terminating the assessment at the
first failure.
"""
from __future__ import annotations
import time
from typing import Any, Callable, Dict, List
from gatekeeper.models import Evidence

_TRANSIENT_MARKERS = [
    "timeout", "temporarily", "try again", "rate limit", "429", "503",
    "network unreachable", "connection", "unavailable",
]
_PERMANENT_MARKERS = [
    "not found", "404", "unauthorized", "401", "forbidden", "403",
    "invalid", "not implemented", "no such",
]


def _classify_failure(message: str) -> str:
    text = message.lower()
    if any(m in text for m in _PERMANENT_MARKERS):
        return "permanent"
    if any(m in text for m in _TRANSIENT_MARKERS):
        return "transient"
    return "unknown"


def investigate(
    claim: str,
    probe: Callable[[], Dict[str, Any]],
    source: str,
    max_retries: int = 3,
    base_delay_seconds: float = 0.0,
) -> Dict[str, Any]:
    """
    probe() must return a dict with at least a "success" bool. On failure
    it should include an "error" string for failure classification.
    """
    attempts: List[Dict[str, Any]] = []
    failure_kind = "unknown"

    for attempt in range(1, max_retries + 1):
        result = probe()
        attempts.append({"attempt": attempt, "result": result})
        if result.get("success"):
            evidence = Evidence(
                claim=claim,
                source=source,
                kind="observation",
                confidence=0.95,
                verified=True,
                notes=f"Investigator succeeded on attempt {attempt}/{max_retries}.",
            )
            return {
                "outcome": "verified",
                "attempts": attempts,
                "failure_kind": None,
                "evidence": evidence,
            }

        error_msg = str(result.get("error", ""))
        failure_kind = _classify_failure(error_msg)
        if failure_kind != "transient" or attempt == max_retries:
            break
        if base_delay_seconds:
            time.sleep(base_delay_seconds * (2 ** (attempt - 1)))

    evidence = Evidence(
        claim=claim,
        source=source,
        kind="observation",
        confidence=0.3 if failure_kind == "transient" else 0.6,
        verified=False,
        notes=f"Investigator failed after {len(attempts)} attempt(s); classified as {failure_kind}.",
    )
    return {
        "outcome": "transient_failure" if failure_kind == "transient" else "permanent_failure",
        "attempts": attempts,
        "failure_kind": failure_kind,
        "evidence": evidence,
    }
