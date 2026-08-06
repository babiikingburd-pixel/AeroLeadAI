"""
orchestrator.py — the loop.

    while True:
        collect data        -> experiment_service.run_experiment()
        analyze performance  -> evaluator_service (called inside experiment_service)
        rank (weekly only)   -> ranking_service.run_weekly_ranking()
        plan next step       -> planner_service.choose_next_objective()
        (never auto-deploy)  -> self_mod_service stops at queued_for_review
        sleep 30 min

Runs as a FastAPI background task (see api/main.py) — not a separate cron,
so it shares the same process/connection pool and is easy to watch via
the /status endpoint.
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timedelta

from services import experiment_service, ranking_service, planner_service

logger = logging.getLogger("orchestrator")

CYCLE_SECONDS = 1800  # 30 minutes, per spec
_last_ranking_run: datetime | None = None
_running = False
_last_cycle_summary: dict = {}


def is_running() -> bool:
    return _running


def get_last_cycle_summary() -> dict:
    return _last_cycle_summary


async def _maybe_run_weekly_ranking():
    global _last_ranking_run
    now = datetime.utcnow()
    if _last_ranking_run is None or now - _last_ranking_run >= timedelta(days=7):
        logger.info("Running weekly ranking...")
        results = await ranking_service.run_weekly_ranking()
        _last_ranking_run = now
        return results
    return None


async def run_cycle() -> dict:
    """One iteration of the loop — also callable manually/on-demand."""
    global _last_cycle_summary

    plan = await planner_service.choose_next_objective()
    summary = {"timestamp": datetime.utcnow().isoformat(), "plan": plan}

    if plan["objective"] == "run_experiment":
        result = await experiment_service.run_experiment()
        summary["experiment_result"] = result

    elif plan["objective"] == "draft_proposal":
        # Drafting the actual diff is intentionally left to a human or a
        # separate AI-drafting call — this loop only surfaces *that* a
        # proposal is needed and for which strategy. See self_mod_service
        # .propose_improvement() for where a drafted proposal gets filed.
        summary["needs_proposal_for"] = plan["target"]

    elif plan["objective"] == "await_human_review":
        summary["note"] = f"{plan['pending_count']} proposal(s) awaiting human review — pausing new proposals."

    ranking_results = await _maybe_run_weekly_ranking()
    if ranking_results is not None:
        summary["weekly_ranking"] = ranking_results

    _last_cycle_summary = summary
    logger.info("Cycle complete: %s", summary["plan"])
    return summary


async def loop_forever():
    global _running
    _running = True
    try:
        while _running:
            try:
                await run_cycle()
            except Exception as e:
                logger.exception("Orchestrator cycle failed: %s", e)
            await asyncio.sleep(CYCLE_SECONDS)
    finally:
        _running = False


def stop():
    global _running
    _running = False
