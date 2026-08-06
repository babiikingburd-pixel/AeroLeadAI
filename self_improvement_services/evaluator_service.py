"""
services/evaluator_service.py — scores individual runs and whole strategies.

Composite score weights revenue highest (that's the actual business goal),
then success rate, then time — a fast strategy that fails a lot or makes no
money should never outrank a slow one that reliably makes money.
"""
from __future__ import annotations
from services import memory_service

# Tunable weights — adjust as you learn what actually matters for AeroLeadAI.
WEIGHTS = {
    "revenue": 0.55,
    "success_rate": 0.30,
    "speed": 0.15,
}


def score_run(success: bool, time_required_seconds: float, revenue_generated: float) -> float:
    """Score a single run, 0-100."""
    revenue_component = min(revenue_generated / 500.0, 1.0) * 100  # $500 = saturate
    success_component = 100.0 if success else 0.0
    # Faster is better, but only up to a point — normalize against a 5 min ceiling.
    speed_component = max(0.0, 1.0 - (time_required_seconds / 300.0)) * 100

    return round(
        revenue_component * WEIGHTS["revenue"]
        + success_component * WEIGHTS["success_rate"]
        + speed_component * WEIGHTS["speed"],
        2,
    )


async def score_strategy(strategy_name: str, since_days: int = 7) -> dict:
    """Score a strategy's overall performance over a window."""
    stats = await memory_service.get_strategy_stats(strategy_name, since_days)
    n = stats.get("n") or 0
    if n == 0:
        return {"strategy": strategy_name, "n": 0, "composite_score": None}

    avg_revenue = float(stats["avg_revenue"] or 0)
    avg_time = float(stats["avg_time"] or 0)
    success_rate = float(stats["success_rate"] or 0)

    composite = score_run(
        success=success_rate >= 0.5,  # nominal flag, real weighting below
        time_required_seconds=avg_time,
        revenue_generated=avg_revenue,
    )
    # success_rate is continuous (0-1) here, not boolean — recompute properly:
    revenue_component = min(avg_revenue / 500.0, 1.0) * 100
    speed_component = max(0.0, 1.0 - (avg_time / 300.0)) * 100
    composite = round(
        revenue_component * WEIGHTS["revenue"]
        + (success_rate * 100) * WEIGHTS["success_rate"]
        + speed_component * WEIGHTS["speed"],
        2,
    )

    return {
        "strategy": strategy_name,
        "n": n,
        "avg_revenue": avg_revenue,
        "avg_time_seconds": avg_time,
        "success_rate": success_rate,
        "composite_score": composite,
    }
