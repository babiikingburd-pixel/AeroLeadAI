"""
services/memory_service.py — LAYER 1: MEMORY

Every run of every strategy/task gets written here. This is the substrate
everything else (experiments, ranking, self-mod proposals) reads from.
Nothing gets smarter without this being complete and honest — log failures
too, not just wins, or the ranking layer optimizes on survivorship bias.
"""
from __future__ import annotations
import json
from typing import Any, Optional
from db.pool import get_pool


async def save_run(
    task: str,
    strategy: str,
    success: bool,
    time_required_seconds: float,
    revenue_generated: float = 0.0,
    prompt_used: Optional[str] = None,
    user_feedback: Optional[str] = None,
    result: Optional[dict[str, Any]] = None,
    score: Optional[float] = None,
) -> int:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO learning_memory
            (task, strategy, prompt_used, time_required_seconds, success,
             revenue_generated, user_feedback, score, result)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
        """,
        task, strategy, prompt_used, time_required_seconds, success,
        revenue_generated, user_feedback, score,
        json.dumps(result or {}),
    )
    return row["id"]


async def get_history(strategy: Optional[str] = None, limit: int = 200) -> list[dict]:
    pool = await get_pool()
    if strategy:
        rows = await pool.fetch(
            "SELECT * FROM learning_memory WHERE strategy = $1 ORDER BY created_at DESC LIMIT $2",
            strategy, limit,
        )
    else:
        rows = await pool.fetch(
            "SELECT * FROM learning_memory ORDER BY created_at DESC LIMIT $1", limit
        )
    return [dict(r) for r in rows]


async def get_strategy_stats(strategy: str, since_days: int = 7) -> dict:
    """Aggregate stats used by both the evaluator and the ranking layer."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT
            COUNT(*) AS n,
            AVG(revenue_generated) AS avg_revenue,
            AVG(time_required_seconds) AS avg_time,
            AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) AS success_rate
        FROM learning_memory
        WHERE strategy = $1
          AND created_at >= NOW() - ($2 || ' days')::interval
        """,
        strategy, str(since_days),
    )
    return dict(row) if row else {"n": 0, "avg_revenue": 0, "avg_time": 0, "success_rate": 0}
