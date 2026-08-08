"""
sandbox/test_runner.py — runs a proposed change's test suite in isolation.

This does NOT execute the proposal against production data or the live
pipeline. It runs against a fixture/replay dataset so a bad proposal can
never touch a real lead, a real client, or real money.
"""
from __future__ import annotations
from typing import Any


async def run_tests(proposal_diff: str, target_component: str) -> dict[str, Any]:
    """
    Returns: {"pass_rate": float 0-1, "total": int, "passed": int, "failures": [...]}

    TODO: wire this to your actual test harness. Suggested shape:
      1. Write proposal_diff to a throwaway branch/worktree (not main).
      2. Run the existing test suite for `target_component` against it.
      3. Additionally replay N historical scenarios from `learning_memory`
         where this component's output is known, and compare old vs new
         output for regressions — this is more important than unit tests
         for a prompt/strategy change, since the "bug" you're guarding
         against is silent quality drift, not a crash.
    """
    # ------------------------------------------------------------------
    # STUB — always fails safe (0% pass) until wired to a real harness,
    # so nothing gets auto-queued for review by accident.
    # ------------------------------------------------------------------
    return {
        "pass_rate": 0.0,
        "total": 0,
        "passed": 0,
        "failures": ["Sandbox test harness not yet wired to a real test suite."],
    }
