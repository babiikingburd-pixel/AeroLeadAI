"""
services/experiment_service.py — LAYER 2: EXPERIMENT ENGINE

Every cycle, picks a strategy (currently random among active strategies —
swap in an epsilon-greedy or UCB1 bandit here once you have enough history
in learning_memory to make that worthwhile instead of noise) and runs it
through the real pipeline via crawler_service, then records the outcome
into both `experiments` and `learning_memory`.
"""
from __future__ import annotations
import random
from db.pool import get_pool
from services import crawler_service, memory_service, evaluator_service


async def get_active_strategies() -> list[str]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT name FROM strategies WHERE is_active = TRUE")
    return [r["name"] for r in rows]


async def choose_strategy() -> str:
    strategies = await get_active_strategies()
    if not strategies:
        raise RuntimeError("No active strategies configured in `strategies` table.")
    return random.choice(strategies)


async def run_experiment(strategy_name: str | None = None) -> dict:
    strategy_name = strategy_name or await choose_strategy()

    result = await crawler_service.execute_strategy(strategy_name)

    score = evaluator_service.score_run(
        success=result["success"],
        time_required_seconds=result["time_seconds"],
        revenue_generated=result["revenue_generated"],
    )

    # Layer 1: write to permanent memory
    await memory_service.save_run(
        task="lead_generation_scan",
        strategy=strategy_name,
        success=result["success"],
        time_required_seconds=result["time_seconds"],
        revenue_generated=result["revenue_generated"],
        result=result.get("raw"),
        score=score,
    )

    # Layer 2: also write to the experiments table for quick same-day review
    pool = await get_pool()
    strategy_row = await pool.fetchrow("SELECT id FROM strategies WHERE name = $1", strategy_name)
    kept = score >= 40.0  # rough same-run keep/discard signal; weekly ranking is authoritative
    await pool.execute(
        """
        INSERT INTO experiments (strategy_id, strategy_name, leads_generated, time_seconds, revenue, kept, result)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        """,
        strategy_row["id"] if strategy_row else None,
        strategy_name,
        result["leads_generated"],
        result["time_seconds"],
        result["revenue_generated"],
        kept,
        __import__("json").dumps(result.get("raw", {})),
    )

    return {"strategy": strategy_name, "score": score, **result}
