"""
Reproducibility engine.

REAL-NOW, stdlib only. Runs a caller-supplied test callable N times,
records each raw outcome, and reports whether the result is reproducible
(same outcome every time) or flaky (inconsistent) — this is what lets the
Gatekeeper distinguish "this worked once, by luck" from "this reliably
works," which none of v1-v1.3 did (they classified from a single
evidence snapshot).
"""
from __future__ import annotations
import time
from typing import Any, Callable, Dict, List


def run_reproducibility_test(test_fn: Callable[[], Any], attempts: int = 3, delay_seconds: float = 0.0) -> Dict[str, Any]:
    """
    test_fn should return a JSON-serializable result on success and raise
    on failure. Returns a report; never raises itself.
    """
    outcomes: List[Dict[str, Any]] = []
    for i in range(attempts):
        entry: Dict[str, Any] = {"attempt": i + 1}
        try:
            result = test_fn()
            entry["status"] = "success"
            entry["result"] = result
        except Exception as exc:  # noqa: BLE001 — intentionally broad, this is a test harness
            entry["status"] = "failure"
            entry["error"] = f"{type(exc).__name__}: {exc}"
        outcomes.append(entry)
        if delay_seconds and i < attempts - 1:
            time.sleep(delay_seconds)

    successes = [o for o in outcomes if o["status"] == "success"]
    distinct_results = {str(o.get("result")) for o in successes}
    reproducible = len(successes) == attempts and len(distinct_results) <= 1

    return {
        "attempts": attempts,
        "success_count": len(successes),
        "failure_count": attempts - len(successes),
        "reproducible": reproducible,
        "distinct_result_count": len(distinct_results),
        "outcomes": outcomes,
    }
