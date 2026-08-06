"""
services/planner_service.py — chooses what the orchestrator should focus
on next: run more experiments, trigger ranking, or generate a self-mod
proposal for a 'middle' tier strategy.
"""
from __future__ import annotations
from db.pool import get_pool


async def get_middle_tier_candidates(week_start: str | None = None) -> list[dict]:
    """Strategies flagged 'modified' in the most recent ranking — these are
    the candidates a proposal-writer (human or AI-drafted) should target."""
    pool = await get_pool()
    if week_start:
        rows = await pool.fetch(
            "SELECT * FROM strategy_rankings WHERE tier = 'middle' AND week_start = $1",
            week_start,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT * FROM strategy_rankings
            WHERE tier = 'middle' AND week_start = (SELECT MAX(week_start) FROM strategy_rankings)
            """
        )
    return [dict(r) for r in rows]


async def choose_next_objective() -> dict:
    """
    Very simple priority order for the orchestrator loop:
      1. If there are pending proposals awaiting review -> surface that (do nothing automated).
      2. If there are middle-tier strategies with no open proposal yet -> draft one.
      3. Otherwise -> run another experiment.
    """
    pool = await get_pool()
    pending = await pool.fetchval(
        "SELECT COUNT(*) FROM improvement_proposals WHERE status = 'queued_for_review'"
    )
    if pending and pending > 0:
        return {"objective": "await_human_review", "pending_count": pending}

    middle = await get_middle_tier_candidates()
    open_targets = {
        r["target_component"]
        for r in await pool.fetch(
            "SELECT target_component FROM improvement_proposals WHERE status NOT IN ('rejected','deployed')"
        )
    }
    undrafted = [m for m in middle if m["strategy_name"] not in open_targets]
    if undrafted:
        return {"objective": "draft_proposal", "target": undrafted[0]["strategy_name"]}

    return {"objective": "run_experiment"}
