"""
services/crawler_service.py — LAYER 2 support: executes a strategy against
the real AeroLeadAI pipeline (lead scoring / vision / dispatch agents).

This is the integration seam into your existing three-agent FastAPI backend.
Wire the TODO below to whatever internal function/HTTP call already runs a
scan (county pull, imagery fetch, scoring, dispatch draft) — everything else
in this layer (experiments, ranking, memory) is agnostic to how that happens.
"""
from __future__ import annotations
import time
from typing import Any


async def execute_strategy(strategy_name: str, params: dict[str, Any] | None = None) -> dict:
    """
    Runs one strategy end-to-end and returns a normalized result dict:
        {
          "success": bool,
          "leads_generated": int,
          "revenue_generated": float,   # estimated $ value of qualified leads
          "time_seconds": float,
          "raw": {...}                  # whatever the underlying pipeline returned
        }
    """
    start = time.monotonic()
    params = params or {}

    # ------------------------------------------------------------------
    # TODO: replace this stub with the real call into your existing
    # three-agent backend, e.g.:
    #
    #   from your_existing_backend import lead_scoring_agent, vision_agent
    #   leads = await lead_scoring_agent.run(strategy=strategy_name, **params)
    #   scored = await vision_agent.score(leads)
    #
    # Each strategy name should map to a different ordering/weighting of
    # the same underlying pipeline calls (that's the "experiment" — same
    # tools, different strategy for using them).
    # ------------------------------------------------------------------
    if strategy_name == "search_counties_first":
        result = await _stub_run(leads=12, revenue=1800.0)
    elif strategy_name == "search_storm_reports_first":
        result = await _stub_run(leads=18, revenue=2600.0)
    elif strategy_name == "prioritize_roof_damage":
        result = await _stub_run(leads=9, revenue=2100.0)
    elif strategy_name == "prioritize_commercial":
        result = await _stub_run(leads=4, revenue=3400.0)
    else:
        result = {"success": False, "leads_generated": 0, "revenue_generated": 0.0, "raw": {}}

    result["time_seconds"] = time.monotonic() - start
    return result


async def _stub_run(leads: int, revenue: float) -> dict:
    """Placeholder until wired to the real pipeline — remove once live."""
    return {
        "success": True,
        "leads_generated": leads,
        "revenue_generated": revenue,
        "raw": {"note": "STUB — replace crawler_service.execute_strategy with real pipeline call"},
    }
