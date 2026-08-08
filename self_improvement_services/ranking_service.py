"""
services/ranking_service.py — LAYER 3: RANKING

Run this once a week (see orchestrator.py). Scores every active strategy,
sorts by composite score, and applies:
    top 20%    -> kept as-is
    middle 60% -> flagged 'modified' (a self-mod proposal should target these)
    bottom 20% -> deactivated (soft delete — is_active = FALSE, history kept)

Nothing is hard-deleted. learning_memory and experiments rows are permanent —
that history is exactly what future proposals reason from.
"""
from __future__ import annotations
import math
from datetime import date
from db.pool import get_pool
from services import evaluator_service, experiment_service


async def run_weekly_ranking() -> list[dict]:
    strategies = await experiment_service.get_active_strategies()
    scored = []
    for name in strategies:
        s = await evaluator_service.score_strategy(name, since_days=7)
        if s["composite_score"] is not None:
            scored.append(s)

    if not scored:
        return []

    scored.sort(key=lambda s: s["composite_score"], reverse=True)

    n = len(scored)
    top_cutoff = max(1, math.ceil(n * 0.2))
    bottom_cutoff = max(1, math.floor(n * 0.2))

    pool = await get_pool()
    week_start = date.today()
    results = []

    for i, s in enumerate(scored):
        if i < top_cutoff:
            tier, action = "top", "kept"
        elif i >= n - bottom_cutoff:
            tier, action = "bottom", "deleted"
            await pool.execute("UPDATE strategies SET is_active = FALSE WHERE name = $1", s["strategy"])
        else:
            tier, action = "middle", "modified"
            # Modification itself happens via the self_mod layer (Layer 4) —
            # this just flags which strategies are candidates for a proposal.

        await pool.execute(
            """
            INSERT INTO strategy_rankings
                (week_start, strategy_name, avg_revenue, avg_time_seconds, success_rate, composite_score, tier, action_taken)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            """,
            week_start, s["strategy"], s["avg_revenue"], s["avg_time_seconds"],
            s["success_rate"], s["composite_score"], tier, action,
        )
        results.append({**s, "tier": tier, "action": action})

    return results
